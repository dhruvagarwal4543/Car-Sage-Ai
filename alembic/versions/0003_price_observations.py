"""Attributed price observations, without changing catalogue or saved cars.

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('price_observations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('firebase_uid', sa.String(128)),
        sa.Column('car_id', sa.Integer(), sa.ForeignKey('catalogue_cars.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('source_website', sa.String(255), nullable=False),
        sa.Column('source_url', sa.String(2048), nullable=False),
        sa.Column('source_data_id', sa.String(200)),
        sa.Column('price_inr', sa.BigInteger(), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False),
        sa.Column('price_type', sa.String(20), nullable=False),
        sa.Column('vehicle_status', sa.String(4), nullable=False),
        sa.Column('model_year', sa.Integer(), nullable=False),
        sa.Column('market', sa.String(100), nullable=False),
        sa.Column('observed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('source_kind', sa.String(24), nullable=False),
        sa.Column('provenance', sa.String(2000), nullable=False),
        sa.Column('rights', sa.String(2000), nullable=False),
        sa.Column('confidence', sa.String(24), nullable=False),
        sa.Column('series_key', sa.String(64), nullable=False),
        sa.Column('dedup_key', sa.String(64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('dedup_key', name='uq_price_observations_dedup'),
        sa.CheckConstraint('price_inr > 0 AND price_inr <= 10000000000', name='ck_price_observations_price'),
        sa.CheckConstraint("currency = 'INR'", name='ck_price_observations_currency'),
        sa.CheckConstraint("price_type IN ('ex_showroom','on_road','used_asking','advertised')", name='ck_price_observations_type'),
        sa.CheckConstraint("vehicle_status IN ('new','used')", name='ck_price_observations_status'),
        sa.CheckConstraint("source_kind IN ('user_observation','manufacturer','authorized_dataset')", name='ck_price_observations_kind'),
        sa.CheckConstraint("firebase_uid IS NOT NULL OR source_kind <> 'user_observation'", name='ck_price_observations_owner'),
    )
    op.create_index('ix_price_observations_owner_series_date', 'price_observations', ['firebase_uid', 'series_key', 'observed_at'])
    op.create_index('ix_price_observations_car_date', 'price_observations', ['car_id', 'observed_at'])


def downgrade():
    # Explicit downgrade removes observations only; catalogue/saved-car rows are preserved.
    op.drop_table('price_observations')
