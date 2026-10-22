from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CarOut(BaseModel):
    """Public view of a catalogue car. Missing attributes are null: nothing is invented."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    source_row: int
    make: str
    model: str
    variant: str
    fuel_type: str
    price_inr: int = Field(description="Ex-showroom price in INR (new car). Not an on-road price.")
    transmission: str | None = None
    body_type: str | None = None
    drivetrain: str | None = None
    cylinder_configuration: str | None = None
    emission_norm: str | None = None
    seating_capacity: int | None = None
    doors: int | None = None
    cylinders: int | None = None
    gears: int | None = None
    number_of_airbags: int | None = None
    displacement_cc: float | None = None
    power_ps: float | None = None
    torque_nm: float | None = None
    length_mm: float | None = None
    width_mm: float | None = None
    height_mm: float | None = None
    wheelbase_mm: float | None = None
    ground_clearance_mm: float | None = None
    kerb_weight_kg: float | None = None
    gross_vehicle_weight_kg: float | None = None
    fuel_tank_litres: float | None = None
    boot_space_litres: float | None = None
    min_turning_radius_m: float | None = None
    mileage_kmpl: float | None = None
    family_group: str | None = None
    tags: list[str] = []


class CarPage(BaseModel):
    items: list[CarOut]
    total: int
    page: int
    page_size: int


class CarDetail(CarOut):
    related: list[CarOut] = []


class CompareField(BaseModel):
    key: str
    label: str
    unit: str | None
    values: list[float | int | str | None]
    differs: bool
    best_index: int | None = Field(None, description="Index of the best value where 'better' is defined; null otherwise")
    missing: list[int] = Field(description="Indices of cars for which the value is not recorded")


class CompareOut(BaseModel):
    cars: list[CarOut]
    fields: list[CompareField]


class FiltersOut(BaseModel):
    makes: list[dict]
    fuel_types: list[dict]
    transmissions: list[dict]
    body_types: list[dict]
    seating_capacities: list[int]
    price_min: int | None
    price_max: int | None


class Preferences(BaseModel):
    max_price: int | None = Field(None, ge=1, le=10**10)
    min_price: int | None = Field(None, ge=0, le=10**10)
    fuel_types: list[str] = Field(default_factory=list, max_length=6)
    transmissions: list[Literal["manual", "automatic"]] = Field(default_factory=list)
    body_types: list[str] = Field(default_factory=list, max_length=10)
    min_seats: int | None = Field(None, ge=1, le=20)
    use_case: Literal["family", "city"] | None = None
    priorities: list[Literal["price", "mileage", "power", "space", "safety"]] = Field(default_factory=list, max_length=5)
    limit: int = Field(5, ge=1, le=10)

    @model_validator(mode="after")
    def _budget_order(self):
        if self.min_price is not None and self.max_price is not None and self.min_price > self.max_price:
            raise ValueError("min_price must not exceed max_price")
        return self


class Recommendation(BaseModel):
    car: CarOut
    score: float = Field(description="0-100 heuristic score relative to the other matches; not an absolute quality rating")
    reasons: list[str]
    tradeoffs: list[str]
    missing: list[str]


class RecommendationOut(BaseModel):
    recommendations: list[Recommendation]
    candidates_considered: int
    applied_defaults: list[str]
    relaxed_constraints: list[str]
    notes: list[str]


class AssistantIn(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    context: Preferences | None = Field(None, description="Preferences returned by the previous turn, to refine them")


class AssistantOut(BaseModel):
    reply: str
    intent: Literal["recommend", "compare", "lookup", "help"]
    preferences: Preferences | None
    cars: list[CarOut]


class PriceFeatures(BaseModel):
    power_ps: float | None = Field(None, ge=1, le=3000)
    torque_nm: float | None = Field(None, ge=1, le=3000)
    displacement_cc: float | None = Field(None, ge=0, le=10000)
    length_mm: float | None = Field(None, ge=1000, le=8000)
    width_mm: float | None = Field(None, ge=1000, le=3000)
    height_mm: float | None = Field(None, ge=800, le=3500)
    wheelbase_mm: float | None = Field(None, ge=1000, le=5000)
    fuel_tank_litres: float | None = Field(None, ge=0, le=300)
    kerb_weight_kg: float | None = Field(None, ge=100, le=8000)
    ground_clearance_mm: float | None = Field(None, ge=50, le=700)
    boot_space_litres: float | None = Field(None, ge=0, le=3000)
    mileage_kmpl: float | None = Field(None, ge=0, le=100)
    cylinders: int | None = Field(None, ge=0, le=16)
    gears: int | None = Field(None, ge=1, le=12)
    seating_capacity: int | None = Field(None, ge=1, le=20)
    doors: int | None = Field(None, ge=1, le=6)
    number_of_airbags: int | None = Field(None, ge=0, le=20)
    make: str | None = Field(None, max_length=80)
    fuel_type: str | None = Field(None, max_length=40)
    body_type: str | None = Field(None, max_length=40)
    transmission: str | None = Field(None, max_length=40)
    drivetrain: str | None = Field(None, max_length=20)
    cylinder_configuration: str | None = Field(None, max_length=40)
    emission_norm: str | None = Field(None, max_length=20)


class PriceIn(BaseModel):
    car_id: int | None = Field(None, description="Estimate for a catalogue car (uses its specifications)")
    features: PriceFeatures | None = None


class PriceOut(BaseModel):
    predicted_price_inr: int
    actual_ex_showroom_price_inr: int | None = None
    experimental: bool = True
    typical_error: str
    warnings: list[str]
    model_info: dict


class UserOut(BaseModel):
    uid: str
    email: str | None = None
