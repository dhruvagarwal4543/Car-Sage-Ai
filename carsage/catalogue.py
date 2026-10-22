"""Read-only catalogue queries. Every query is parameterised by SQLAlchemy and hides rows flagged as exact duplicates."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from carsage.models import CatalogueCar as C
from carsage.rules import derive_tags
from carsage.schemas import CarOut, CompareField, CompareOut

SORTS = {
    "price_asc": [C.price_inr.asc()],
    "price_desc": [C.price_inr.desc()],
    "power_desc": [C.power_ps.desc().nulls_last()],
    "mileage_desc": [C.mileage_kmpl.desc().nulls_last()],
    "name": [C.make.asc(), C.model.asc(), C.variant.asc()],
}
# key, label, unit, which direction is "better" (None = just show)
COMPARE_FIELDS = [
    ("price_inr", "Ex-showroom price", "INR", "low"), ("fuel_type", "Fuel type", None, None), ("transmission", "Transmission", None, None),
    ("body_type", "Body type", None, None), ("mileage_kmpl", "Mileage (ARAI)", "km/l", "high"), ("displacement_cc", "Engine displacement", "cc", None),
    ("power_ps", "Power", "PS", "high"), ("torque_nm", "Torque", "Nm", "high"), ("seating_capacity", "Seats", None, None),
    ("number_of_airbags", "Airbags", None, "high"), ("boot_space_litres", "Boot space", "litres", "high"),
    ("fuel_tank_litres", "Fuel tank", "litres", None), ("length_mm", "Length", "mm", None), ("width_mm", "Width", "mm", None),
    ("height_mm", "Height", "mm", None), ("wheelbase_mm", "Wheelbase", "mm", None), ("ground_clearance_mm", "Ground clearance", "mm", None),
    ("kerb_weight_kg", "Kerb weight", "kg", None), ("emission_norm", "Emission norm", None, None), ("drivetrain", "Drivetrain", None, None),
]
VISIBLE = C.is_exact_duplicate.is_(False)


def to_out(car):
    out = CarOut.model_validate(car)
    out.tags = derive_tags(car)
    return out


def _like_escape(token):
    return token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def apply_filters(stmt, *, q=None, make=None, model=None, fuel_type=None, transmission=None, body_type=None,
                  min_price=None, max_price=None, min_seats=None):
    stmt = stmt.where(VISIBLE)
    for tok in (q or "").lower().split():
        pat = f"%{_like_escape(tok)}%"
        stmt = stmt.where(func.lower(C.make).like(pat, escape="\\") | func.lower(C.model).like(pat, escape="\\") | func.lower(C.variant).like(pat, escape="\\"))
    for col, val in ((C.make, make), (C.model, model), (C.fuel_type, fuel_type), (C.transmission, transmission), (C.body_type, body_type)):
        if val:
            stmt = stmt.where(func.lower(col) == val.lower())
    if min_price is not None:
        stmt = stmt.where(C.price_inr >= min_price)
    if max_price is not None:
        stmt = stmt.where(C.price_inr <= max_price)
    if min_seats is not None:
        stmt = stmt.where(C.seating_capacity >= min_seats)
    return stmt


def list_cars(s: Session, *, sort="price_asc", page=1, page_size=20, **filters):
    base = apply_filters(select(C), **filters)
    total = s.scalar(select(func.count()).select_from(base.subquery()))
    rows = s.scalars(base.order_by(*SORTS[sort], C.id).limit(page_size).offset((page - 1) * page_size)).all()
    return [to_out(r) for r in rows], total


def get_car(s: Session, car_id: int):
    return s.scalars(select(C).where(C.id == car_id, VISIBLE)).first()


def related_cars(s: Session, car, n=4):
    """Other models in the same body type, nearest in price (within +/-25%)."""
    stmt = select(C).where(VISIBLE, C.model != car.model, C.price_inr.between(car.price_inr * 0.75, car.price_inr * 1.25))
    if car.body_type:
        stmt = stmt.where(C.body_type == car.body_type)
    rows = s.scalars(stmt.order_by(func.abs(C.price_inr - car.price_inr), C.id).limit(n * 4)).all()
    seen, out = set(), []
    for r in rows:                                   # one variant per model
        if r.model_group not in seen:
            seen.add(r.model_group); out.append(to_out(r))
    return out[:n]


def compare(s: Session, ids):
    found = {c.id: c for c in s.scalars(select(C).where(C.id.in_(ids), VISIBLE))}
    missing = [i for i in ids if i not in found]
    if missing:
        raise LookupError(missing)
    cars = [found[i] for i in ids]
    fields = []
    for key, label, unit, better in COMPARE_FIELDS:
        vals = [getattr(c, key) for c in cars]
        present = [v for v in vals if v is not None]
        best = None
        if better and len(present) > 1 and len(set(present)) > 1:
            target = min(present) if better == "low" else max(present)
            best = vals.index(target)
        fields.append(CompareField(key=key, label=label, unit=unit, values=vals, differs=len(set(present)) > 1 or (bool(present) and len(present) < len(vals)),
                                   best_index=best, missing=[i for i, v in enumerate(vals) if v is None]))
    return CompareOut(cars=[to_out(c) for c in cars], fields=fields)


def filter_options(s: Session):
    def counts(col):
        rows = s.execute(select(col, func.count()).where(VISIBLE, col.is_not(None)).group_by(col).order_by(col)).all()
        return [{"value": v, "count": n} for v, n in rows]
    lo, hi = s.execute(select(func.min(C.price_inr), func.max(C.price_inr)).where(VISIBLE)).one()
    seats = s.scalars(select(C.seating_capacity).where(VISIBLE, C.seating_capacity.is_not(None)).distinct().order_by(C.seating_capacity)).all()
    return {"makes": counts(C.make), "fuel_types": counts(C.fuel_type), "transmissions": counts(C.transmission),
            "body_types": counts(C.body_type), "seating_capacities": list(seats), "price_min": lo, "price_max": hi}
