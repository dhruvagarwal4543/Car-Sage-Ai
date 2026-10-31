"""Offline, operator-reviewed import. No scraper or remote download: python -m carsage.import_prices file.json --apply."""
import argparse
import json
from pathlib import Path

from sqlalchemy.orm import Session

from carsage.db import get_engine, migration_url, require_target_confirmation
from carsage.history import ObservationIn, ingest


def read_import(path):
    document = json.loads(Path(path).read_text())
    if document.get('synthetic') is not False:
        raise ValueError('Production imports must explicitly declare synthetic: false')
    if document.get('source_kind') not in {'manufacturer', 'authorized_dataset'}:
        raise ValueError('Only reviewed manufacturer or authorized-dataset imports are supported')
    for field in ('provenance', 'rights'):
        if not isinstance(document.get(field), str) or not 10 <= len(document[field]) <= 2000:
            raise ValueError(f'Provide a documented {field} statement (10–2000 characters)')
    records = document.get('observations')
    if not isinstance(records, list) or not 1 <= len(records) <= 5000:
        raise ValueError('An import must contain 1–5000 observations')
    return document, [ObservationIn.model_validate(row) for row in records]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file')
    parser.add_argument('--apply', action='store_true', help='Write validated observations; default validates without writes')
    args = parser.parse_args()
    document, observations = read_import(args.file)
    print(f'Validated {len(observations)} observations. Rights and identity still require operator review.')
    if not args.apply:
        return
    url = migration_url()
    require_target_confirmation(url, 'historical price import')
    created = 0
    with Session(get_engine(url)) as session:
        for observation in observations:
            _, added = ingest(session, observation, None, kind=document['source_kind'], provenance=document['provenance'], rights=document['rights'])
            created += added
    print(f'Created {created}; {len(observations) - created} duplicates. Repeating an interrupted import is safe.')


if __name__ == '__main__':
    main()
