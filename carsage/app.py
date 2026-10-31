"""CarSage AI API.  Run:  uvicorn carsage.app:app --reload"""
import logging
import os
import time

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from carsage import assistant as assistant_mod
from carsage import catalogue, predict as predict_mod, recommend as recommend_mod
from carsage import history as history_mod
from carsage.auth import current_user
from carsage.config import validate_startup
from carsage.db import get_engine
from carsage.models import CatalogueCar, SavedCar
from carsage.schemas import (AssistantIn, AssistantOut, CarDetail, CarOut, CarPage, CompareOut, FiltersOut, PriceIn, PriceOut,
                             Preferences, RecommendationOut, UserOut)

log = logging.getLogger("carsage.api")
SortKey = str


def create_app(engine=None) -> FastAPI:
    load_dotenv()
    validate_startup()      # logs missing setting NAMES; refuses to start in production if the configuration is unsafe
    app = FastAPI(title="CarSage AI API", version="0.1.0",
                  description="New-car catalogue, explainable recommendations, a catalogue-grounded assistant and an experimental price estimate. "
                              "Prices are ex-showroom (new cars); there is no live inventory or on-road pricing.")
    app.state.engine = engine
    origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Authorization", "Content-Type"])

    @app.middleware("http")
    async def access_log(request: Request, call_next):
        t0 = time.perf_counter()
        resp = await call_next(request)
        log.info("%s %s -> %s (%.0f ms)", request.method, request.url.path, resp.status_code, (time.perf_counter() - t0) * 1000)   # no query string, headers or body
        return resp

    @app.exception_handler(OperationalError)
    async def db_down(_: Request, exc: OperationalError):
        log.error("database error: %s", type(exc).__name__)
        return JSONResponse({"detail": "Database unavailable"}, status_code=503)

    @app.exception_handler(RuntimeError)
    async def config_error(_: Request, exc: RuntimeError):
        if "DATABASE_URL" in str(exc):
            return JSONResponse({"detail": "Database is not configured"}, status_code=503)
        log.exception("unhandled runtime error")
        return JSONResponse({"detail": "Internal server error"}, status_code=500)

    def get_db(request: Request):
        if request.app.state.engine is None:
            request.app.state.engine = get_engine()
        with Session(request.app.state.engine) as s:
            yield s

    # ---- health
    @app.get("/api/health", tags=["health"])
    def health():
        """Liveness: the application process is up (does not touch the database)."""
        return {"status": "ok"}

    @app.get("/api/health/ready", tags=["health"])
    def ready(s: Session = Depends(get_db)):
        """Readiness: the database answers. 503 otherwise."""
        s.execute(text("select 1"))
        return {"status": "ok", "database": "ok", "cars": s.scalar(select(text("count(*)")).select_from(CatalogueCar).where(catalogue.VISIBLE))}

    # ---- catalogue
    @app.get("/api/cars", response_model=CarPage, tags=["catalogue"])
    def cars(q: str | None = Query(None, max_length=100), make: str | None = Query(None, max_length=80), model: str | None = Query(None, max_length=120),
             fuel_type: str | None = Query(None, max_length=40), transmission: str | None = Query(None, max_length=40),
             body_type: str | None = Query(None, max_length=40), min_price: int | None = Query(None, ge=0, le=10**10),
             max_price: int | None = Query(None, ge=0, le=10**10), min_seats: int | None = Query(None, ge=1, le=20),
             sort: str = Query("price_asc", pattern="^(price_asc|price_desc|power_desc|mileage_desc|name)$"),
             page: int = Query(1, ge=1, le=10000), page_size: int = Query(20, ge=1, le=50),
             view: str = Query("variants", pattern="^(variants|models)$"), s: Session = Depends(get_db)):
        if min_price is not None and max_price is not None and min_price > max_price:
            raise HTTPException(422, "min_price must not exceed max_price")
        items, total = catalogue.list_cars(s, sort=sort, page=page, page_size=page_size, view=view, q=q, make=make, model=model, fuel_type=fuel_type,
                                           transmission=transmission, body_type=body_type, min_price=min_price, max_price=max_price, min_seats=min_seats)
        return CarPage(items=items, total=total, page=page, page_size=page_size)

    @app.get("/api/cars/compare", response_model=CompareOut, tags=["catalogue"])
    def compare(ids: str = Query(..., description="2-4 comma-separated car ids", max_length=60), s: Session = Depends(get_db)):
        try:
            parsed = [int(x) for x in ids.split(",")]
        except ValueError:
            raise HTTPException(422, "ids must be comma-separated integers")
        if not 2 <= len(parsed) <= 4 or len(set(parsed)) != len(parsed):
            raise HTTPException(422, "provide 2 to 4 distinct car ids")
        try:
            return catalogue.compare(s, parsed)
        except LookupError as e:
            raise HTTPException(404, f"cars not found: {e.args[0]}")

    @app.get("/api/cars/{car_id}", response_model=CarDetail, tags=["catalogue"])
    def car(car_id: int, s: Session = Depends(get_db)):
        c = catalogue.get_car(s, car_id)
        if c is None:
            raise HTTPException(404, "car not found")
        d = CarDetail.model_validate(catalogue.to_out(c))
        d.related = catalogue.related_cars(s, c)
        return d

    @app.get("/api/filters", response_model=FiltersOut, tags=["catalogue"])
    def filters(q: str | None = Query(None, max_length=100), make: str | None = Query(None, max_length=80), model: str | None = Query(None, max_length=120),
                fuel_type: str | None = Query(None, max_length=40), transmission: str | None = Query(None, max_length=40), body_type: str | None = Query(None, max_length=40),
                min_price: int | None = Query(None, ge=0, le=10**10), max_price: int | None = Query(None, ge=0, le=10**10),
                min_seats: int | None = Query(None, ge=1, le=20), s: Session = Depends(get_db)):
        if min_price is not None and max_price is not None and min_price > max_price:
            raise HTTPException(422, "min_price must not exceed max_price")
        return catalogue.filter_options(s, q=q, make=make, model=model, fuel_type=fuel_type, transmission=transmission, body_type=body_type,
                                        min_price=min_price, max_price=max_price, min_seats=min_seats)

    # ---- intelligence
    @app.post("/api/catalogue/match", tags=["extension"])
    def match_vehicle(body: history_mod.MatchIn, s: Session = Depends(get_db)):
        return history_mod.match(s, body)

    @app.post("/api/price-history/query", tags=["price history"])
    def public_history(body: history_mod.HistoryQuery, s: Session = Depends(get_db)):
        try:
            return history_mod.history(s, body)
        except LookupError as exc:
            raise HTTPException(404, str(exc))
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/me/price-history/query", tags=["price history"])
    def private_history(body: history_mod.HistoryQuery, user: UserOut = Depends(current_user), s: Session = Depends(get_db)):
        try:
            return history_mod.history(s, body, user.uid)
        except LookupError as exc:
            raise HTTPException(404, str(exc))
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/me/price-observations", tags=["price history"])
    def record_price(body: history_mod.ObservationIn, user: UserOut = Depends(current_user), s: Session = Depends(get_db)):
        try:
            row, created = history_mod.ingest(s, body, user.uid)
            return {"created": created, "observation": history_mod.point(row)}
        except LookupError as exc:
            raise HTTPException(404, str(exc))
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/recommendations", response_model=RecommendationOut, tags=["recommendations"])
    def recommendations(prefs: Preferences, s: Session = Depends(get_db)):
        return recommend_mod.recommend(s, prefs)

    @app.post("/api/assistant", response_model=AssistantOut, tags=["assistant"])
    def assistant(body: AssistantIn, s: Session = Depends(get_db)):
        return assistant_mod.respond(s, body.message, body.context)

    @app.post("/api/price-predictions", response_model=PriceOut, tags=["prediction (experimental)"])
    def price_prediction(body: PriceIn, s: Session = Depends(get_db)):
        actual, feats = None, {}
        if body.car_id is not None:
            c = catalogue.get_car(s, body.car_id)
            if c is None:
                raise HTTPException(404, "car not found")
            feats, actual = {k: getattr(c, k, None) for k in predict_mod.ATTR_TO_FEATURE}, c.price_inr
        elif body.features is not None:
            feats = body.features.model_dump()
            if all(v is None for v in feats.values()):
                raise HTTPException(422, "provide at least one specification")
        else:
            raise HTTPException(422, "provide car_id or features")
        try:
            price, warnings, info, err = predict_mod.predict(feats)
        except predict_mod.ModelUnavailable as e:
            raise HTTPException(503, str(e))
        return PriceOut(predicted_price_inr=price, actual_ex_showroom_price_inr=actual, typical_error=err, warnings=warnings, model_info=info)

    # ---- user-specific (Firebase-authenticated)
    @app.get("/api/me", response_model=UserOut, tags=["user"])
    def me(user: UserOut = Depends(current_user)):
        return user

    @app.get("/api/me/saved-cars", response_model=list[CarOut], tags=["user"])
    def saved(user: UserOut = Depends(current_user), s: Session = Depends(get_db)):
        rows = s.scalars(select(CatalogueCar).join(SavedCar, SavedCar.car_id == CatalogueCar.id)
                         .where(SavedCar.firebase_uid == user.uid).order_by(SavedCar.created_at.desc(), SavedCar.id.desc())).all()
        return [catalogue.to_out(r) for r in rows]

    @app.put("/api/me/saved-cars/{car_id}", status_code=204, tags=["user"])
    def save_car(car_id: int, user: UserOut = Depends(current_user), s: Session = Depends(get_db)):
        if catalogue.get_car(s, car_id) is None:
            raise HTTPException(404, "car not found")
        if s.scalar(select(SavedCar.id).where(SavedCar.firebase_uid == user.uid, SavedCar.car_id == car_id)) is None:
            s.add(SavedCar(firebase_uid=user.uid, car_id=car_id))
            try:
                s.commit()
            except IntegrityError:   # concurrent duplicate request: already saved
                s.rollback()

    @app.delete("/api/me/saved-cars/{car_id}", status_code=204, tags=["user"])
    def unsave_car(car_id: int, user: UserOut = Depends(current_user), s: Session = Depends(get_db)):
        row = s.scalars(select(SavedCar).where(SavedCar.firebase_uid == user.uid, SavedCar.car_id == car_id)).first()
        if row is None:
            raise HTTPException(404, "car is not in your saved list")
        s.delete(row); s.commit()

    return app


app = create_app()
