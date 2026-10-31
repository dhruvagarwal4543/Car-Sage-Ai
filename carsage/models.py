"""Database models. `catalogue_cars` holds the new-car variant catalogue imported from the dataset.

It is deliberately separate from future user-created marketplace listings (own table, own phase):
no seller, location, image or used-car price columns exist here.
"""
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class CatalogueCar(Base):
    __tablename__ = "catalogue_cars"
    __table_args__ = (UniqueConstraint("source_row", name="uq_catalogue_cars_source_row"),
                      CheckConstraint("price_inr > 0", name="ck_catalogue_cars_price_positive"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_row: Mapped[int] = mapped_column(Integer, nullable=False)   # row id in the raw CSV: traceability + idempotent import key
    # identity (required)
    make: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    variant: Mapped[str] = mapped_column(String(160), nullable=False)
    fuel_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    price_inr: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)   # ex-showroom, new car
    # categorical specs (optional; NULL = not recorded in the dataset)
    transmission: Mapped[str | None] = mapped_column(String(40), index=True)
    body_type: Mapped[str | None] = mapped_column(String(40), index=True)
    drivetrain: Mapped[str | None] = mapped_column(String(20))
    cylinder_configuration: Mapped[str | None] = mapped_column(String(40))
    emission_norm: Mapped[str | None] = mapped_column(String(20))
    # integer specs
    seating_capacity: Mapped[int | None] = mapped_column(Integer, index=True)
    doors: Mapped[int | None] = mapped_column(Integer)
    cylinders: Mapped[int | None] = mapped_column(Integer)
    gears: Mapped[int | None] = mapped_column(Integer)
    number_of_airbags: Mapped[int | None] = mapped_column(Integer)
    # numeric specs (units in the column name)
    displacement_cc: Mapped[float | None] = mapped_column(Float)
    power_ps: Mapped[float | None] = mapped_column(Float)
    torque_nm: Mapped[float | None] = mapped_column(Float)
    length_mm: Mapped[float | None] = mapped_column(Float)
    width_mm: Mapped[float | None] = mapped_column(Float)
    height_mm: Mapped[float | None] = mapped_column(Float)
    wheelbase_mm: Mapped[float | None] = mapped_column(Float)
    ground_clearance_mm: Mapped[float | None] = mapped_column(Float)
    kerb_weight_kg: Mapped[float | None] = mapped_column(Float)
    gross_vehicle_weight_kg: Mapped[float | None] = mapped_column(Float)
    fuel_tank_litres: Mapped[float | None] = mapped_column(Float)
    boot_space_litres: Mapped[float | None] = mapped_column(Float)
    min_turning_radius_m: Mapped[float | None] = mapped_column(Float)
    mileage_kmpl: Mapped[float | None] = mapped_column(Float)          # ARAI-certified
    # grouping / duplicate flags from preprocessing (rows are flagged, never deleted)
    model_group: Mapped[str | None] = mapped_column(String(200))
    family_group: Mapped[str | None] = mapped_column(String(200), index=True)
    is_exact_duplicate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    duplicate_of_source_row: Mapped[int | None] = mapped_column(Integer)
    near_duplicate_group_size: Mapped[int | None] = mapped_column(Integer)
    source_dataset: Mapped[str] = mapped_column(String(80), nullable=False, default="cars_ds_final.csv")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SavedCar(Base):
    """A catalogue car saved by an authenticated user. `firebase_uid` is the verified Firebase UID (no credentials are stored here)."""
    __tablename__ = "saved_cars"
    __table_args__ = (UniqueConstraint("firebase_uid", "car_id", name="uq_saved_cars_user_car"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    firebase_uid: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    car_id: Mapped[int] = mapped_column(Integer, ForeignKey("catalogue_cars.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PriceObservation(Base):
    """Private page observations or reviewed public imports, separate from catalogue prices."""
    __tablename__ = "price_observations"
    __table_args__ = (
        UniqueConstraint("dedup_key", name="uq_price_observations_dedup"),
        CheckConstraint("price_inr > 0 AND price_inr <= 10000000000", name="ck_price_observations_price"),
        CheckConstraint("currency = 'INR'", name="ck_price_observations_currency"),
        CheckConstraint("price_type IN ('ex_showroom','on_road','used_asking','advertised')", name="ck_price_observations_type"),
        CheckConstraint("vehicle_status IN ('new','used')", name="ck_price_observations_status"),
        CheckConstraint("source_kind IN ('user_observation','manufacturer','authorized_dataset')", name="ck_price_observations_kind"),
        CheckConstraint("firebase_uid IS NOT NULL OR source_kind <> 'user_observation'", name="ck_price_observations_owner"),
        Index("ix_price_observations_owner_series_date", "firebase_uid", "series_key", "observed_at"),
        Index("ix_price_observations_car_date", "car_id", "observed_at"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    firebase_uid: Mapped[str | None] = mapped_column(String(128))
    car_id: Mapped[int] = mapped_column(Integer, ForeignKey("catalogue_cars.id", ondelete="RESTRICT"), nullable=False)
    source_website: Mapped[str] = mapped_column(String(255), nullable=False)
    source_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    source_data_id: Mapped[str | None] = mapped_column(String(200))
    price_inr: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    price_type: Mapped[str] = mapped_column(String(20), nullable=False)
    vehicle_status: Mapped[str] = mapped_column(String(4), nullable=False)
    model_year: Mapped[int] = mapped_column(Integer, nullable=False)
    market: Mapped[str] = mapped_column(String(100), nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(24), nullable=False)
    provenance: Mapped[str] = mapped_column(String(2000), nullable=False)
    rights: Mapped[str] = mapped_column(String(2000), nullable=False)
    confidence: Mapped[str] = mapped_column(String(24), nullable=False)
    series_key: Mapped[str] = mapped_column(String(64), nullable=False)
    dedup_key: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
