"""search indexes and per-user saved cars

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for col in ("model", "transmission", "seating_capacity"):
        op.create_index(f"ix_catalogue_cars_{col}", "catalogue_cars", [col])
    op.create_table(
        "saved_cars",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("firebase_uid", sa.String(128), nullable=False),
        sa.Column("car_id", sa.Integer(), sa.ForeignKey("catalogue_cars.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("firebase_uid", "car_id", name="uq_saved_cars_user_car"),
    )
    op.create_index("ix_saved_cars_firebase_uid", "saved_cars", ["firebase_uid"])
    op.create_index("ix_saved_cars_car_id", "saved_cars", ["car_id"])


def downgrade() -> None:
    op.drop_table("saved_cars")
    for col in ("seating_capacity", "transmission", "model"):
        op.drop_index(f"ix_catalogue_cars_{col}", table_name="catalogue_cars")
