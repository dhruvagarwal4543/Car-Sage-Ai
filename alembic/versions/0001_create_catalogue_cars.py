"""create catalogue_cars

Revision ID: 0001
Revises:
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalogue_cars",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_row", sa.Integer(), nullable=False),
        sa.Column("make", sa.String(80), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("variant", sa.String(160), nullable=False),
        sa.Column("fuel_type", sa.String(40), nullable=False),
        sa.Column("price_inr", sa.BigInteger(), nullable=False),
        sa.Column("transmission", sa.String(40)),
        sa.Column("body_type", sa.String(40)),
        sa.Column("drivetrain", sa.String(20)),
        sa.Column("cylinder_configuration", sa.String(40)),
        sa.Column("emission_norm", sa.String(20)),
        sa.Column("seating_capacity", sa.Integer()),
        sa.Column("doors", sa.Integer()),
        sa.Column("cylinders", sa.Integer()),
        sa.Column("gears", sa.Integer()),
        sa.Column("number_of_airbags", sa.Integer()),
        sa.Column("displacement_cc", sa.Float()),
        sa.Column("power_ps", sa.Float()),
        sa.Column("torque_nm", sa.Float()),
        sa.Column("length_mm", sa.Float()),
        sa.Column("width_mm", sa.Float()),
        sa.Column("height_mm", sa.Float()),
        sa.Column("wheelbase_mm", sa.Float()),
        sa.Column("ground_clearance_mm", sa.Float()),
        sa.Column("kerb_weight_kg", sa.Float()),
        sa.Column("gross_vehicle_weight_kg", sa.Float()),
        sa.Column("fuel_tank_litres", sa.Float()),
        sa.Column("boot_space_litres", sa.Float()),
        sa.Column("min_turning_radius_m", sa.Float()),
        sa.Column("mileage_kmpl", sa.Float()),
        sa.Column("model_group", sa.String(200)),
        sa.Column("family_group", sa.String(200)),
        sa.Column("is_exact_duplicate", sa.Boolean(), nullable=False),
        sa.Column("duplicate_of_source_row", sa.Integer()),
        sa.Column("near_duplicate_group_size", sa.Integer()),
        sa.Column("source_dataset", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("source_row", name="uq_catalogue_cars_source_row"),
        sa.CheckConstraint("price_inr > 0", name="ck_catalogue_cars_price_positive"),
    )
    for col in ("make", "fuel_type", "price_inr", "body_type", "family_group"):
        op.create_index(f"ix_catalogue_cars_{col}", "catalogue_cars", [col])


def downgrade() -> None:
    op.drop_table("catalogue_cars")
