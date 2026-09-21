import os
import pytest
from alembic.config import Config
from alembic import command
from sqlalchemy import create_engine, inspect


def test_alembic_upgrade_and_downgrade(tmp_path):
    db_file = tmp_path / "test_migration.db"
    db_url = f"sqlite:///{db_file.as_posix()}"

    alembic_ini = os.path.abspath("alembic.ini")
    cfg = Config(alembic_ini)
    cfg.set_main_option("sqlalchemy.url", db_url)

    # 1. Run upgrade head
    command.upgrade(cfg, "head")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    tables = inspector.get_table_names()

    # Verify essential tables created
    assert "knowledge_bases" in tables
    assert "bots" in tables
    assert "hosts" in tables
    assert "tasks" in tables
    assert "sessions" in tables
    assert "messages" in tables
    assert "documents" in tables

    # Check task table columns
    task_cols = [c["name"] for c in inspector.get_columns("tasks")]
    assert "id" in task_cols
    assert "task_type" in task_cols
    assert "status" in task_cols
    assert "payload" in task_cols

    # 2. Run downgrade base
    command.downgrade(cfg, "base")

    inspector = inspect(engine)
    remaining_tables = inspector.get_table_names()
    assert "knowledge_bases" not in remaining_tables
    assert "tasks" not in remaining_tables
