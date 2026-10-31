"""Synthetic observations are isolated in temporary test databases, never production seed data."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from carsage.app import create_app
from carsage.auth import current_user
from carsage.history import HistoryQuery, ObservationIn, cutoff, history, ingest, series_stats
from carsage.models import Base, CatalogueCar, PriceObservation
from carsage.schemas import UserOut

NOW = datetime.now(timezone.utc)


@pytest.fixture
def environment(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'history.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all([CatalogueCar(id=i, source_row=i, make='Tata', model=model, variant=variant, fuel_type='Petrol', transmission=transmission,
                                     price_inr=900000, is_exact_duplicate=False) for i, model, variant, transmission in [(1, 'Nexon', 'XM', 'Manual'), (2, 'Nexon', 'XZ', 'Automatic'), (3, 'Nexon Ev', 'XM', 'Automatic')]])
        session.commit()
    app = create_app(engine)
    app.dependency_overrides[current_user] = lambda: UserOut(uid='alice', email=None, name=None)
    return engine, app, TestClient(app)


def observation(**patch):
    return ObservationIn.model_validate(dict(car_id=1, make='Tata', model='Nexon', variant='XM', source_url='https://market.example/listing/1',
        price_inr=900000, price_type='ex_showroom', vehicle_status='new', model_year=2021, market='IN / Delhi', observed_at=NOW.isoformat(), consent=True) | patch)


def query(**patch):
    return HistoryQuery.model_validate(dict(car_id=1, model_year=2021, market='IN / Delhi', price_type='ex_showroom', vehicle_status='new', years=3) | patch)


def test_strict_matching_never_silently_substitutes_a_similar_model(environment):
    _, _, client = environment
    assert client.post('/api/catalogue/match', json={'make': 'Tata', 'model': 'Nexon', 'variant': 'XM'}).json()['status'] == 'exact'
    ambiguous = client.post('/api/catalogue/match', json={'make': 'Tata', 'model': 'Nexon'}).json()
    assert ambiguous['status'] == 'ambiguous' and ambiguous['requires_confirmation']
    assert {car['id'] for car in ambiguous['candidates']} == {1, 2}
    assert client.post('/api/catalogue/match', json={'make': 'Tata', 'model': 'Nexon EV Plus'}).json()['status'] == 'unmatched'


def test_record_deduplication_provenance_and_private_ownership(environment):
    engine, app, client = environment
    body = observation().model_dump(mode='json')
    first = client.post('/api/me/price-observations', json=body)
    assert first.status_code == 200 and first.json()['created']
    assert client.post('/api/me/price-observations', json=body).json()['created'] is False
    mine = client.post('/api/me/price-history/query', json=query().model_dump()).json()
    point = mine['series'][0]['observations'][0]
    assert point['source_url'] == body['source_url'] and point['source_website'] == 'market.example'
    assert point['source_kind'] == 'user_observation' and point['confidence'] == 'user_confirmed'
    assert client.post('/api/price-history/query', json=query().model_dump()).json()['series'] == []
    app.dependency_overrides[current_user] = lambda: UserOut(uid='bob', email=None, name=None)
    assert client.post('/api/me/price-history/query', json=query().model_dump()).json()['series'] == []
    with Session(engine) as session:
        assert len(session.scalars(select(PriceObservation)).all()) == 1


def test_no_variant_price_type_market_year_or_used_listing_mixing(environment):
    engine, _, _ = environment
    with Session(engine) as session:
        for change in [{}, {'price_type': 'on_road'}, {'model_year': 2020}, {'market': 'IN / Mumbai'},
                       {'car_id': 2, 'variant': 'XZ'}, {'source_url': 'https://market.example/listing/2'}]:
            ingest(session, observation(**change), 'alice')
        result = history(session, query(), 'alice')
        assert len(result['series']) == 2  # different physical URLs stay separate
        assert all(len(series['observations']) == 1 for series in result['series'])
        for url in ['https://market.example/used/a', 'https://market.example/used/b']:
            ingest(session, observation(source_url=url, price_type='used_asking', vehicle_status='used'), 'alice')
        assert len(history(session, query(price_type='used_asking', vehicle_status='used'), 'alice')['series']) == 2


def test_range_change_calculation_and_insufficient_coverage(environment):
    engine, _, _ = environment
    with Session(engine) as session:
        for when, value in [(NOW - timedelta(days=800), 800000), (NOW - timedelta(days=400), 850000), (NOW - timedelta(days=1), 900000)]:
            ingest(session, observation(observed_at=when, price_inr=value), None, kind='manufacturer', rights='Synthetic test-only rights statement', provenance='Synthetic fixture in an isolated test database')
        full = history(session, query(), now=NOW)
        series = full['series'][0]
        assert len(series['observations']) == 3
        assert series['absolute_change_inr'] == 100000 and series['percentage_change'] == 12.5
        assert series['available_years'] == [1, 2]
        assert 'not yet available' in full['notice']
        one = history(session, query(years=1), now=NOW)['series'][0]
        assert len(one['observations']) == 1 and one['percentage_change'] is None
        assert full['last_updated'] == (NOW - timedelta(days=1)).isoformat()
    assert cutoff(datetime(2024, 2, 29, tzinfo=timezone.utc), 1).day == 28
    assert series_stats([], NOW)['absolute_change_inr'] is None


@pytest.mark.parametrize('patch', [dict(price_inr=0), dict(price_inr=12.5), dict(consent=False), dict(currency='USD'), dict(variant=None),
    dict(source_url='javascript:alert(1)'), dict(source_url='https://user:password@market.example/1'), dict(observed_at='2020-01-01'),
    dict(observed_at=(NOW + timedelta(days=1)).isoformat()), dict(vehicle_status='used', price_type='ex_showroom')])
def test_invalid_observations_rejected(environment, patch):
    _, _, client = environment
    body = observation().model_dump(mode='json') | patch
    assert client.post('/api/me/price-observations', json=body).status_code == 422


def test_identity_conflicts_backdating_and_authentication_rejected(environment):
    _, app, client = environment
    for patch in [dict(variant='XZ'), dict(fuel_type='Diesel'), dict(transmission='Automatic'), dict(observed_at=(NOW - timedelta(days=2)).isoformat())]:
        assert client.post('/api/me/price-observations', json=observation().model_dump(mode='json') | patch).status_code == 422
    assert client.post('/api/me/price-observations', json=observation().model_dump(mode='json') | {'car_id': 999}).status_code == 404
    app.dependency_overrides.clear()
    assert client.post('/api/me/price-observations', json=observation().model_dump(mode='json')).status_code == 401


def test_import_rejects_undocumented_and_synthetic_data(tmp_path):
    import json
    from carsage.import_prices import read_import
    file = tmp_path / 'prices.json'
    file.write_text(json.dumps({'synthetic': True, 'observations': []}))
    with pytest.raises(ValueError, match='synthetic'):
        read_import(file)
    file.write_text(json.dumps({'synthetic': False, 'source_kind': 'manufacturer', 'observations': []}))
    with pytest.raises(ValueError, match='provenance'):
        read_import(file)
