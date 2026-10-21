from alembic import context
from sqlalchemy import create_engine

from carsage.db import database_url
from carsage.models import Base

config = context.config
target_metadata = Base.metadata
URL = config.get_main_option("sqlalchemy.url") or database_url()   # tests may set sqlalchemy.url explicitly

if context.is_offline_mode():
    context.configure(url=URL, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with create_engine(URL).connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
