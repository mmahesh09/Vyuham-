"""Settings: managed-Postgres URLs work as given."""

import pytest

from app.config import Settings


@pytest.mark.parametrize(
    "given, used",
    [
        ("postgres://u:p@db.example.com:5432/app?sslmode=require", "postgresql+psycopg://u:p@db.example.com:5432/app?sslmode=require"),
        ("postgresql://u:p@db.example.com/app", "postgresql+psycopg://u:p@db.example.com/app"),
        ("postgresql+psycopg://u:p@db/app", "postgresql+psycopg://u:p@db/app"),
        ("sqlite:///./dev.db", "sqlite:///./dev.db"),
    ],
)
def test_database_url_uses_psycopg3(given, used):
    assert Settings(database_url=given, _env_file=None).database_url == used
