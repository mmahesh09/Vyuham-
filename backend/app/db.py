from collections.abc import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine(url: str):
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False}, pool_pre_ping=True)
    s = get_settings()
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=s.db_pool_size,
        max_overflow=s.db_max_overflow,
        pool_timeout=10,  # fail fast with a clear error rather than queueing requests for 30 s
        pool_recycle=1800,  # managed Postgres closes idle connections; replace ours before it does
    )


engine = _make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

_SET = text("SELECT set_config('app.workspace_id', :ws, true), set_config('app.bypass_rls', :bypass, true)")


def apply_rls(session: Session, connection) -> None:
    """Tell Postgres row-level security which workspace this transaction acts for (app/tenancy.py).

    Transaction-local (`set_config(..., true)`), so a pooled connection never carries one request's
    workspace into the next. Unset means "no rows" for the protected tables. SQLite has no RLS.
    """
    if connection.dialect.name != "postgresql":
        return
    bypass = "on" if session.info.get("rls_bypass") else "off"
    connection.execute(_SET, {"ws": session.info.get("rls_workspace_id") or "", "bypass": bypass})


@event.listens_for(Session, "after_begin")
def _rls_on_begin(session: Session, transaction, connection) -> None:
    apply_rls(session, connection)


def worker_session() -> Session:
    """A session for trusted background code (jobs, schedulers): it may work across workspaces."""
    db = SessionLocal()
    db.info["rls_bypass"] = True
    return db


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_rls_role(eng) -> None:
    """Row-level security does nothing for a superuser or a BYPASSRLS role. In production, refuse to
    start as one (unless RLS_ENFORCE=false), so a misconfigured deploy can't quietly lose the second wall."""
    import logging

    if eng.dialect.name != "postgresql":
        return
    s = get_settings()
    log = logging.getLogger("app.db")
    try:
        with eng.connect() as c:
            row = c.execute(text("SELECT rolsuper, rolbypassrls, current_user FROM pg_roles WHERE rolname = current_user")).first()
    except Exception:  # the database may not be up yet; the health check reports that
        log.exception("couldn't check the database role for row-level security")
        return
    if row is None or not (row[0] or row[1]):
        return
    msg = (
        f"The API connects to Postgres as {row[2]!r}, which bypasses row-level security. Connect as a role "
        "without SUPERUSER or BYPASSRLS (see DEPLOY.md, 'Row-level security')."
    )
    if s.environment == "production" and s.rls_enforce:
        raise RuntimeError(msg)
    log.warning("%s Tenant isolation still holds through the app's checks.", msg)
