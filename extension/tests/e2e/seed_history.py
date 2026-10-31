# Throwaway SQLite DB for UI tests only. The observations are SYNTHETIC test data and live outside the project.
import os, sys
from datetime import datetime, timedelta, timezone
DB = os.path.join(os.environ.get("TMPDIR", "/tmp"), "carsage-uitest.db")
os.environ["DATABASE_URL"] = "sqlite:///" + DB
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))
if os.path.exists(DB): os.remove(DB)
from sqlalchemy.orm import Session
from carsage.db import get_engine
from carsage.models import Base, CatalogueCar
from carsage.history import ObservationIn, ingest
e = get_engine(); Base.metadata.create_all(e)
with Session(e) as s:
    s.add(CatalogueCar(id=1, source_row=1, make="Hyundai", model="Creta", variant="E", fuel_type="Petrol", transmission="Manual", price_inr=1090700, is_exact_duplicate=False, model_group="Hyundai Creta"))
    s.add(CatalogueCar(id=2, source_row=2, make="Hyundai", model="Venue", variant="S", fuel_type="Petrol", transmission="Manual", price_inr=900000, is_exact_duplicate=False, model_group="Hyundai Venue"))
    s.commit()
    now = datetime.now(timezone.utc)
    for days, price in [(1000, 980000), (700, 1020000), (330, 1060000), (20, 1090700)]:
        ingest(s, ObservationIn(make="Hyundai", model="Creta", variant="E", car_id=1, source_url="https://makers.example/creta", price_inr=price, price_type="ex_showroom", vehicle_status="new",
               model_year=2024, market="India, Delhi", observed_at=now - timedelta(days=days), consent=True), None, kind="manufacturer", provenance="Synthetic UI test data", rights="Synthetic UI test data, not real")
print("seeded", DB)
