"""Customer database connections (PostgreSQL, MySQL) and the datasets synced from them.

Connections are for editors and owners: viewers see the datasets, not the database behind them. The
password is write-only, and a saved one is only ever sent to the server it was entered for: changing
the host, port or type, or lowering the SSL protection, needs the password again. Creating datasets
runs their first sync straight away, so the new dataset is ready to chart when the request returns.
"""

from __future__ import annotations

import logging
import math
import threading
from collections.abc import Iterator
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.connectors.base import ConnectorError, ConnSpec, spec_for
from app.connectors.extract import validate_query
from app.connectors.introspect import list_tables, preview
from app.crypto import SecretError, encrypt
from app.db import get_db
from app.models import Connection, Dataset, WorkspaceMember
from app.routers.datasets import _unique_name, check_quota, parquet_path, require_editor
from app.schemas import (
    ConnectionIn,
    ConnectionOut,
    ConnectionPatch,
    ConnectionTestIn,
    ConnectionTestOut,
    PreviewOut,
    SyncCreatedOut,
    SyncDatasetsIn,
    TableOut,
)
from app.security import current_membership
from app.sync import SyncError, sync_dataset

router = APIRouter(prefix="/connections", tags=["connections"])
log = logging.getLogger("app.connections")

SSL_STRENGTH = {"disable": 0, "require": 1, "verify-full": 2}
# Requests that wait on a customer's database. They can be slow through no fault of ours, so one workspace
# (or a database built to stall) must not tie up the threads every other customer needs.
PER_WORKSPACE_CONNECTOR_CALLS = 2
_ALL_CONNECTOR_CALLS = threading.BoundedSemaphore(12)
_slots: dict[str, threading.BoundedSemaphore] = {}
_slots_lock = threading.Lock()
PASSWORD_NEEDED = "Enter the password again to use it with a different host, port, database type or a lower SSL setting."


def workspace_slot(workspace_id: str) -> threading.BoundedSemaphore:
    with _slots_lock:
        return _slots.setdefault(workspace_id, threading.BoundedSemaphore(PER_WORKSPACE_CONNECTOR_CALLS))


def connector_slot(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)) -> Iterator[None]:
    """Held while a request talks to a customer's database. Our own database connection is released first."""
    workspace_id = member.workspace_id
    db.commit()
    busy = HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many database requests are running. Try again in a moment.")
    slot = workspace_slot(workspace_id)
    if not slot.acquire(blocking=False):
        raise busy
    try:
        if not _ALL_CONNECTOR_CALLS.acquire(blocking=False):
            raise busy
        try:
            yield
        finally:
            _ALL_CONNECTOR_CALLS.release()
    finally:
        slot.release()


def _may_reuse_password(saved: Connection, kind: str, host: str, port: int, ssl_mode: str) -> bool:
    """A stored password must not be sent anywhere the person who typed it didn't send it."""
    return (
        saved.kind == kind and saved.host.strip().lower() == host.strip().lower() and saved.port == port
        and SSL_STRENGTH[ssl_mode] >= SSL_STRENGTH.get(saved.ssl_mode, 0)
    )


def _owned(db: Session, member: WorkspaceMember, connection_id: str) -> Connection:
    conn = db.get(Connection, connection_id)
    if conn is None or conn.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Connection not found")
    return conn


def _out(db: Session, conn: Connection) -> ConnectionOut:
    count = db.scalar(select(func.count()).select_from(Dataset).where(Dataset.connection_id == conn.id)) or 0
    return ConnectionOut.model_validate(conn).model_copy(update={"dataset_count": count})


def _fail(e: Exception) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e))


def _spec(db: Session, member: WorkspaceMember, conn_id: str) -> tuple[Connection, ConnSpec]:
    conn = _owned(db, member, conn_id)
    try:
        spec = spec_for(conn)
    except (ConnectorError, SecretError) as e:
        raise _fail(e) from e
    db.commit()  # don't hold a connection to our own database while waiting on theirs
    return conn, spec


@router.get("/settings")
def connection_settings(member: WorkspaceMember = Depends(current_membership)):
    """What the connect dialog shows: the address customers should allowlist."""
    return {"egress_ip": get_settings().public_egress_ip or None}


@router.post("/test", response_model=ConnectionTestOut, dependencies=[Depends(connector_slot)])
def test_connection(body: ConnectionTestIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    password = body.password
    if not password and not body.connection_id:
        return ConnectionTestOut(ok=False, message="Enter the password.")
    if not password:
        saved = _owned(db, member, body.connection_id)
        if not _may_reuse_password(saved, body.kind, body.host, body.port, body.ssl_mode):
            return ConnectionTestOut(ok=False, message=PASSWORD_NEEDED)
        try:
            password = spec_for(saved).password
        except SecretError as e:
            return ConnectionTestOut(ok=False, message=str(e))
    db.commit()
    try:
        spec = ConnSpec(body.kind, body.host, body.port, body.database, body.username, password, body.ssl_mode)
        tables = list_tables(spec)
    except ConnectorError as e:
        return ConnectionTestOut(ok=False, message=str(e))
    return ConnectionTestOut(ok=True, message=f"Connected. {len(tables)} tables and views found.", table_count=len(tables))


@router.get("", response_model=list[ConnectionOut])
def list_connections(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    conns = db.scalars(
        select(Connection).where(Connection.workspace_id == member.workspace_id).order_by(Connection.created_at)
    ).all()
    return [_out(db, c) for c in conns]


@router.post("", response_model=ConnectionOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(connector_slot)])
def create_connection(body: ConnectionIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    try:
        spec = ConnSpec(body.kind, body.host, body.port, body.database, body.username, body.password, body.ssl_mode)
        list_tables(spec)  # only save connections that work
    except ConnectorError as e:
        raise _fail(e) from e
    conn = Connection(
        workspace_id=member.workspace_id, created_by=member.user_id, name=body.name.strip(), kind=body.kind,
        host=body.host, port=body.port, database=body.database, username=body.username,
        secret_enc=encrypt(body.password), ssl_mode=body.ssl_mode, status="ok", last_checked_at=datetime.now(timezone.utc),
    )
    db.add(conn)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A connection with this name already exists.") from e
    log.info("connection created id=%s kind=%s workspace=%s", conn.id, conn.kind, conn.workspace_id)
    return _out(db, conn)


@router.patch("/{connection_id}", response_model=ConnectionOut, dependencies=[Depends(connector_slot)])
def update_connection(
    connection_id: str, body: ConnectionPatch, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)
):
    require_editor(member)
    conn = _owned(db, member, connection_id)
    fields = body.model_dump(exclude_unset=True, exclude={"password", "name"})
    try:
        # A field sent as null means "leave it as it is".
        changes = {k: v for k, v in fields.items() if v is not None}
        current = spec_for(conn, password=body.password) if body.password else spec_for(conn)
        spec = ConnSpec(**{**current.__dict__, **changes})
        if not body.password and not _may_reuse_password(conn, spec.kind, spec.host, spec.port, spec.ssl_mode):
            raise ConnectorError(PASSWORD_NEEDED)
        if changes or body.password:
            db.commit()
            list_tables(spec)  # check new details before saving them
    except (ConnectorError, SecretError) as e:
        raise _fail(e) from e
    for k in ("host", "port", "database", "username", "ssl_mode"):
        setattr(conn, k, getattr(spec, k))
    if body.password:
        conn.secret_enc = encrypt(body.password)
    if body.name is not None:
        conn.name = body.name.strip()
    if changes or body.password:
        conn.status, conn.last_error, conn.last_checked_at = "ok", None, datetime.now(timezone.utc)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A connection with this name already exists.") from e
    return _out(db, conn)


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(connection_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Its datasets stay as snapshots of the last sync (they stop refreshing)."""
    require_editor(member)
    conn = _owned(db, member, connection_id)
    for ds in db.scalars(select(Dataset).where(Dataset.connection_id == conn.id)).all():
        ds.connection_id, ds.refresh = None, "manual"
    db.delete(conn)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{connection_id}/tables", response_model=list[TableOut], dependencies=[Depends(connector_slot)])
def connection_tables(connection_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    _, spec = _spec(db, member, connection_id)
    try:
        return [TableOut(**t.as_dict()) for t in list_tables(spec)]
    except ConnectorError as e:
        raise _fail(e) from e


def _cell(v):
    if isinstance(v, Decimal):
        v = float(v)
    if v is None or (isinstance(v, float) and not math.isfinite(v)):  # NaN and Infinity aren't valid JSON
        return None
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray, memoryview)):
        return "(binary)"
    if isinstance(v, (int, float, str, bool)):
        return v
    return str(v)


@router.get("/{connection_id}/preview", response_model=PreviewOut, dependencies=[Depends(connector_slot)])
def connection_preview(
    connection_id: str, table: str = Query(min_length=1, max_length=255),
    member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db),
):
    require_editor(member)
    _, spec = _spec(db, member, connection_id)
    try:
        frame = preview(spec, table)
    except ConnectorError as e:
        raise _fail(e) from e
    return PreviewOut(columns=[str(c) for c in frame.columns], rows=[[_cell(v) for v in row] for row in frame.itertuples(index=False)])


def _discard(db: Session, ds: Dataset) -> None:
    """Remove a dataset whose first sync failed."""
    db.rollback()
    parquet_path(ds.workspace_id, ds.id).unlink(missing_ok=True)
    db.delete(ds)
    db.commit()


@router.post("/{connection_id}/datasets", response_model=SyncCreatedOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(connector_slot)])
def create_synced_datasets(
    connection_id: str, body: SyncDatasetsIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)
):
    """One dataset per table (or one for the query), each synced now. Tables that fail are reported, not created."""
    require_editor(member)
    conn, spec = _spec(db, member, connection_id)
    if body.query:
        try:
            validate_query(body.query, conn.kind)
        except ConnectorError as e:
            raise _fail(e) from e
        sources = [(body.name or "Query", None, body.query)]
    else:
        sources = [(t.split(".")[-1].replace("_", " ").strip().capitalize() or t, t, None) for t in dict.fromkeys(body.tables)]
    check_quota(db, member.workspace_id, new_datasets=len(sources))

    created: list[Dataset] = []
    errors: dict[str, str] = {}
    for base, table, query in sources:
        ds = Dataset(
            workspace_id=member.workspace_id, created_by=member.user_id,
            name=_unique_name(db, member.workspace_id, base[:190]),
            source_filename=(table or f"{conn.name} query")[:255], source_kind=conn.kind, sheet=None,
            row_count=0, columns=[], file_size=0,
            connection_id=conn.id, source_table=table, source_query=query, refresh=body.refresh,
        )
        db.add(ds)
        db.commit()
        try:
            created.append(sync_dataset(db, ds))
        except SyncError as e:
            errors[table or ds.name] = str(e)
            _discard(db, ds)
        except Exception:  # never leave an empty dataset behind
            _discard(db, ds)
            raise
    if not created and errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, next(iter(errors.values())))
    return SyncCreatedOut(datasets=created, errors=errors)
