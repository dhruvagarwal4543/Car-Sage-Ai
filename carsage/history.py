"""Comparable, attributed price observations. User observations are private; no page fetching."""
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from carsage import catalogue
from carsage.models import CatalogueCar, PriceObservation

PriceType = Literal['ex_showroom', 'on_road', 'used_asking', 'advertised']


def clean_url(value):
    u = urlsplit(value)
    if u.scheme not in {'http', 'https'} or not u.hostname or u.username or u.password:
        raise ValueError('A public http(s) source URL without credentials is required')
    return urlunsplit((u.scheme, u.netloc.lower(), u.path or '/', urlencode([(k, v) for k, v in parse_qsl(u.query) if k in {'id', 'listingId'}]), ''))


def norm(value):
    return ' '.join(value.casefold().split())


class MatchIn(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    make: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=120)
    variant: str | None = Field(None, max_length=160)
    fuel_type: str | None = Field(None, max_length=40)
    transmission: str | None = Field(None, max_length=40)


def match(s, data):
    make = {'maruti': 'maruti suzuki', 'mercedes benz': 'mercedes-benz'}.get(norm(data.make), norm(data.make))
    rows = s.scalars(select(CatalogueCar).where(catalogue.VISIBLE, func.lower(CatalogueCar.make) == make,
                                              func.lower(CatalogueCar.model) == norm(data.model)).order_by(CatalogueCar.price_inr, CatalogueCar.id)).all()
    exact = [r for r in rows if data.variant and norm(r.variant) == norm(data.variant)
             and (not data.fuel_type or norm(r.fuel_type) == norm(data.fuel_type))
             and (not data.transmission or norm(r.transmission or '') == norm(data.transmission))]
    return {'status': 'exact' if len(exact) == 1 else 'ambiguous' if rows else 'unmatched',
            'candidates': [catalogue.to_out(r) for r in (exact or rows)][:50], 'total_candidates': len(exact or rows),
            'requires_confirmation': True,
            'note': 'Select the exact variant. Catalogue specifications are historical; model year/generation are not verified by name matching.'}


class ObservationIn(MatchIn):
    car_id: int = Field(gt=0)
    source_url: str = Field(max_length=2048)
    price_inr: int = Field(strict=True, gt=0, le=10**10)
    currency: Literal['INR'] = 'INR'
    price_type: PriceType
    vehicle_status: Literal['new', 'used']
    model_year: int = Field(ge=1900, le=2100)
    market: str = Field(min_length=2, max_length=100, description='Country and pricing city/market; do not assume a city')
    observed_at: datetime
    consent: Literal[True]
    source_data_id: str | None = Field(None, max_length=200)

    @field_validator('source_url')
    @classmethod
    def url(cls, value):
        return clean_url(value)

    @field_validator('observed_at')
    @classmethod
    def dated(cls, value):
        if value.tzinfo is None:
            raise ValueError('Observation time must include a timezone')
        if value > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError('Future observations are not allowed')
        return value.astimezone(timezone.utc)

    @model_validator(mode='after')
    def comparable(self):
        if not self.variant:
            raise ValueError('Confirm an exact variant before recording a price')
        if self.price_type == 'used_asking' and self.vehicle_status != 'used':
            raise ValueError('A used asking price must belong to a used vehicle')
        if self.vehicle_status == 'used' and self.price_type in {'ex_showroom', 'on_road'}:
            raise ValueError('New-car price types cannot describe a used asking price')
        if self.model_year > datetime.now(timezone.utc).year + 1:
            raise ValueError('Model year is in the future')
        return self


class HistoryQuery(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    car_id: int = Field(gt=0)
    model_year: int = Field(ge=1900, le=2100)
    market: str = Field(min_length=2, max_length=100)
    price_type: PriceType
    vehicle_status: Literal['new', 'used']
    years: Literal[1, 2, 3] = 3


def digest(parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=True, separators=(',', ':')).encode()).hexdigest()


def ingest(s, data, uid, *, kind='user_observation', provenance=None, rights=None):
    car = catalogue.get_car(s, data.car_id)
    if car is None:
        raise LookupError('Catalogue vehicle not found')
    if any(norm(getattr(car, k) or '') != norm(getattr(data, k) or '') for k in ('make', 'model', 'variant')):
        raise ValueError('Selected catalogue variant does not match the confirmed identity')
    for k in ('fuel_type', 'transmission'):
        if getattr(data, k) and norm(getattr(car, k) or '') != norm(getattr(data, k)):
            raise ValueError(f'Catalogue {k} conflicts with the observation')
    if kind == 'user_observation' and abs((datetime.now(timezone.utc) - data.observed_at).total_seconds()) > 86400:
        raise ValueError('Page observations must be recorded within 24 hours; use the reviewed historical importer for dated sources')
    if kind != 'user_observation' and not (rights and provenance):
        raise ValueError('Historical imports require rights and provenance')
    host = urlsplit(data.source_url).hostname
    # Used cars and page observations stay tied to the same physical listing, never a market average.
    scope = data.source_url if kind == 'user_observation' or data.vehicle_status == 'used' else host
    series = digest([data.car_id, data.model_year, norm(data.market), data.price_type, data.vehicle_status, kind, scope])
    key = digest([uid, series, data.source_url, data.price_inr, data.observed_at.date().isoformat(), data.source_data_id])
    existing = s.scalar(select(PriceObservation).where(PriceObservation.dedup_key == key))
    if existing:
        return existing, False
    row = PriceObservation(firebase_uid=uid, car_id=data.car_id, source_website=host, source_url=data.source_url,
                           price_inr=data.price_inr, currency='INR', price_type=data.price_type, vehicle_status=data.vehicle_status,
                           model_year=data.model_year, market=norm(data.market), observed_at=data.observed_at, source_data_id=data.source_data_id,
                           source_kind=kind, provenance=provenance or 'User-confirmed observation; not independently verified',
                           rights=rights or 'Private user observation; no redistribution grant', confidence='user_confirmed' if uid else 'reviewed_import',
                           series_key=series, dedup_key=key)
    s.add(row)
    try:
        s.commit()
    except IntegrityError:
        s.rollback()
        row = s.scalar(select(PriceObservation).where(PriceObservation.dedup_key == key))
        if row is None:
            raise
        return row, False
    return row, True


def cutoff(now, years):
    try:
        return now.replace(year=now.year - years)
    except ValueError:
        return now.replace(year=now.year - years, day=28)


def point(row):
    date = row.observed_at.replace(tzinfo=timezone.utc) if row.observed_at.tzinfo is None else row.observed_at
    return {k: getattr(row, k) for k in ('id', 'car_id', 'source_website', 'source_url', 'price_inr', 'currency', 'price_type',
                                       'vehicle_status', 'model_year', 'market', 'source_kind', 'provenance', 'confidence', 'source_data_id')} | {'observed_at': date.isoformat()}


def series_stats(points, now):
    if not points:
        return {'absolute_change_inr': None, 'percentage_change': None, 'available_years': [], 'coverage_start': None, 'coverage_end': None}
    first, last = points[0], points[-1]
    start = datetime.fromisoformat(first['observed_at'])
    change = last['price_inr'] - first['price_inr'] if len(points) > 1 else None
    return {'absolute_change_inr': change,
            'percentage_change': float((Decimal(change) * 100 / Decimal(first['price_inr'])).quantize(Decimal('.01'))) if change is not None and first['price_inr'] > 0 else None,
            'available_years': [n for n in (1, 2, 3) if start <= cutoff(now, n)],
            'coverage_start': first['observed_at'], 'coverage_end': last['observed_at']}


def history(s, query, uid=None, now=None):
    now = now or datetime.now(timezone.utc)
    if catalogue.get_car(s, query.car_id) is None:
        raise LookupError('Catalogue vehicle not found')
    stmt = select(PriceObservation).where(PriceObservation.car_id == query.car_id, PriceObservation.model_year == query.model_year,
            PriceObservation.market == norm(query.market), PriceObservation.price_type == query.price_type,
            PriceObservation.vehicle_status == query.vehicle_status, PriceObservation.observed_at >= cutoff(now, query.years),
            PriceObservation.observed_at <= now,
            or_(PriceObservation.firebase_uid.is_(None), PriceObservation.firebase_uid == uid) if uid else PriceObservation.firebase_uid.is_(None))
    rows = s.scalars(stmt.order_by(PriceObservation.observed_at, PriceObservation.id).limit(5001)).all()
    if len(rows) > 5000:
        raise ValueError('Too many observations; narrow the date range')
    grouped = defaultdict(list)
    for row in rows:
        grouped[row.series_key].append(point(row))
    series = [{'key': key, 'source_kind': points[0]['source_kind'], 'source_website': points[0]['source_website'],
               'source_url': points[0]['source_url'], 'observations': points, **series_stats(points, now)} for key, points in grouped.items()]
    return {'car_id': query.car_id, 'series': series, 'years': query.years, 'last_updated': max((p['observed_at'] for ps in grouped.values() for p in ps), default=None),
            'notice': 'Three-year price history is not yet available for this variant. Historical data currently covers the period shown.'
                      if not any(3 in x['available_years'] for x in series) else 'Separate sources and price types are shown as separate series. No estimated or interpolated observations.'}
