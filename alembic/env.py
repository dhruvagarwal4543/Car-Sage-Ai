from alembic import context
from carsage.db import get_engine, migration_url
from carsage.models import Base

config = context.config
target_metadata = Base.metadata
URL = config.get_main_option("sqlalchemy.url") or migration_url()   # direct (unpooled) Neon URL when set; tests may override

if context.is_offline_mode():
    context.configure(url=URL, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with get_engine(URL).connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
