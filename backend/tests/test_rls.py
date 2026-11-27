"""Postgres row-level security: the second wall behind the app's workspace checks.

The coverage test runs everywhere. The policy tests need Postgres (TEST_DATABASE_URL, as in CI) and a
connection allowed to create a role; they're skipped on SQLite.
"""

import importlib.util
import os
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import rls
from app.db import Base
from app.models import Dataset

MIGRATION = Path(__file__).parents[1] / "migrations" / "versions" / "c5e9a1f3b7d2_organizations_and_team_workspaces.py"
PROBE_ROLE = "vyuham_rls_probe"


def test_every_workspace_table_is_protected_or_explained():
    scoped = {t.name for t in Base.metadata.sorted_tables if "workspace_id" in t.c}
    unexplained = scoped - set(rls.PROTECTED) - set(rls.NOT_PROTECTED)
    assert unexplained == set(), f"add these to app/rls.py (and a migration with their policy): {sorted(unexplained)}"
    assert set(rls.PROTECTED) <= scoped


def test_migration_protects_the_same_tables():
    spec = importlib.util.spec_from_file_location("mig", MIGRATION)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert list(mod.RLS_TABLES) == list(rls.PROTECTED)


def _pg(engine):
    if engine.dialect.name != "postgresql":
        pytest.skip("row-level security is Postgres-only")


@pytest.fixture
def rls_engine(engine):
    """The test database with the policies on, and a non-superuser role to query as."""
    _pg(engine)
    with engine.begin() as c:
        for table in rls.PROTECTED:
            for stmt in rls.policy_sql(table):
                c.execute(text(stmt))
        c.execute(text(f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{PROBE_ROLE}') "
                       f"THEN CREATE ROLE {PROBE_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$"))
        c.execute(text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {PROBE_ROLE}"))
    yield engine


def _seed(engine):
    from tests.conftest import add_org, add_user

    add_user(engine, "u1", token="tok-1", onboarded=False)
    add_user(engine, "u2", token="tok-2", onboarded=False)
    _, ws_a = add_org(engine, "u1", "Alpha")
    _, ws_b = add_org(engine, "u2", "Bravo")
    with Session(engine) as s:
        s.info["rls_bypass"] = True
        for ws, name in ((ws_a, "a-data"), (ws_b, "b-data")):
            s.add(Dataset(workspace_id=ws, name=name, source_filename="x.csv", source_kind="csv", row_count=1, columns=[], file_size=0))
        s.commit()
    return ws_a, ws_b


def _as_probe(session: Session) -> None:
    session.execute(text(f"SET LOCAL ROLE {PROBE_ROLE}"))


def test_unbound_sessions_see_nothing(rls_engine):
    _seed(rls_engine)
    with Session(rls_engine) as s:
        _as_probe(s)
        assert s.execute(text("SELECT count(*) FROM datasets")).scalar() == 0


def test_bound_sessions_see_only_their_workspace(rls_engine):
    from app import tenancy

    ws_a, _ = _seed(rls_engine)
    with Session(rls_engine) as s:
        tenancy.bind(s, ws_a)
        _as_probe(s)
        assert s.execute(text("SELECT name FROM datasets")).scalars().all() == ["a-data"]
        # Even a query that forgets its filter, or asks for the other tenant outright, gets nothing more.
        assert s.execute(text("SELECT count(*) FROM datasets WHERE workspace_id <> :w"), {"w": ws_a}).scalar() == 0


def test_writes_into_another_workspace_are_rejected(rls_engine):
    from sqlalchemy.exc import DBAPIError

    from app import tenancy

    ws_a, ws_b = _seed(rls_engine)
    with Session(rls_engine) as s:
        tenancy.bind(s, ws_a)
        _as_probe(s)
        with pytest.raises(DBAPIError):
            s.execute(text(
                "INSERT INTO datasets (id, workspace_id, name, source_filename, source_kind, row_count, columns, file_size, created_at) "
                "VALUES ('x' || md5(random()::text), :w, 'sneaky', 'x', 'csv', 0, '[]', 0, now())"
            ), {"w": ws_b})
    with Session(rls_engine) as s:
        tenancy.bind(s, ws_a)
        _as_probe(s)
        assert s.execute(text("UPDATE datasets SET name = 'hijacked' WHERE workspace_id = :w"), {"w": ws_b}).rowcount == 0


def test_the_binding_survives_commits(rls_engine):
    """Routers commit mid-request; every new transaction must carry the workspace again."""
    from app import tenancy

    ws_a, _ = _seed(rls_engine)
    with Session(rls_engine) as s:
        tenancy.bind(s, ws_a)
        s.commit()
        _as_probe(s)
        assert s.execute(text("SELECT count(*) FROM datasets")).scalar() == 1


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="needs Postgres")
def test_policies_exist_after_setup(rls_engine):
    with rls_engine.connect() as c:
        rows = c.execute(text("SELECT tablename FROM pg_policies WHERE policyname = :p"), {"p": rls.POLICY}).scalars().all()
    assert set(rows) == set(rls.PROTECTED)
