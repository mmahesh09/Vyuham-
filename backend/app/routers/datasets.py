import json
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.analytics.semantic import refresh_calculated
from app.config import get_settings
from app.db import get_db
from app.ingest import IngestError, ingest, write_parquet
from app.models import Alert, Dataset, WorkspaceMember
from app.query import QueryError, column_readability, connect, distinct_values, page_rows
from app.schemas import DatasetOut, DatasetPatch, RowsOut
from app.security import current_membership

router = APIRouter(prefix="/datasets", tags=["datasets"])

CAN_UPLOAD = {"owner", "editor"}


def parquet_path(workspace_id: str, dataset_id: str) -> Path:
    return Path(get_settings().data_dir) / workspace_id / f"{dataset_id}.parquet"


def _read_capped(file: UploadFile, limit: int) -> bytes:
    """Read the upload without ever holding more than limit + 1 chunk in memory."""
    chunks, size = [], 0
    while chunk := file.file.read(1024 * 1024):
        size += len(chunk)
        if size > limit:
            raise HTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE,
                f"This file is over {limit // (1024 * 1024)} MB. The beta limit is {limit // (1024 * 1024)} MB.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def check_quota(db: Session, workspace_id: str, new_datasets: int = 0, new_bytes: int = 0) -> None:
    """Stop one workspace from filling the disk every customer shares."""
    s = get_settings()
    datasets, used = db.execute(
        select(func.count(Dataset.id), func.coalesce(func.sum(Dataset.file_size), 0)).where(Dataset.workspace_id == workspace_id)
    ).one()
    if datasets + new_datasets > s.max_workspace_datasets:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This workspace has reached its limit of {s.max_workspace_datasets} datasets. Delete one first.")
    if used + new_bytes > s.max_workspace_bytes:
        raise HTTPException(status.HTTP_409_CONFLICT, "This workspace has reached its storage limit. Delete a dataset first.")


def _unique_name(db: Session, workspace_id: str, base: str) -> str:
    taken = set(db.scalars(select(Dataset.name).where(Dataset.workspace_id == workspace_id)))
    name, n = base, 1
    while name in taken:
        n += 1
        name = f"{base} ({n})"
    return name


@router.post("", response_model=DatasetOut, status_code=status.HTTP_201_CREATED)
def upload_dataset(
    file: UploadFile = File(...),
    sheet: str | None = Form(None),
    member: WorkspaceMember = Depends(current_membership),
    db: Session = Depends(get_db),
):
    if member.role not in CAN_UPLOAD:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Viewers can't add data. Ask an owner for editor access.")
    s = get_settings()
    check_quota(db, member.workspace_id, new_datasets=1)
    filename = Path(file.filename or "").name  # never trust a client path
    raw = _read_capped(file, s.max_upload_bytes)
    check_quota(db, member.workspace_id, new_bytes=len(raw))
    # Parsing a big file takes seconds: give the database connection back to the pool meanwhile.
    # The session opens a new one when it's next used; `member` keeps its loaded fields.
    db.close()
    try:
        result = ingest(raw, filename, sheet=sheet or None, max_rows=s.max_upload_rows)
    except IngestError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e

    base = Path(filename).stem.strip()[:150] or "Untitled"
    if result.sheet and len(result.sheets) > 1:
        base = f"{base} · {result.sheet}"[:190]
    dataset = Dataset(
        workspace_id=member.workspace_id,
        created_by=member.user_id,
        name=_unique_name(db, member.workspace_id, base),
        source_filename=filename[:255],
        source_kind=Path(filename).suffix.lower().lstrip("."),
        sheet=result.sheet,
        row_count=len(result.frame),
        columns=[c.as_dict() for c in result.columns],
        file_size=0,
    )
    db.add(dataset)
    db.flush()  # assigns the id
    path = parquet_path(member.workspace_id, dataset.id)
    try:
        dataset.file_size = write_parquet(result.frame, path)
        db.commit()
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    return dataset


@router.get("", response_model=list[DatasetOut])
def list_datasets(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    stmt = select(Dataset).where(Dataset.workspace_id == member.workspace_id).order_by(Dataset.created_at.desc())
    return db.scalars(stmt).all()


def owned_dataset(db: Session, member: WorkspaceMember, dataset_id: str) -> Dataset:
    dataset = db.get(Dataset, dataset_id)
    # Same 404 for "missing" and "another workspace's", so ids can't be probed.
    if dataset is None or dataset.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dataset not found")
    return dataset


def require_editor(member: WorkspaceMember) -> None:
    if member.role not in CAN_UPLOAD:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Viewers can't change data. Ask an owner for editor access.")


@router.get("/{dataset_id}", response_model=DatasetOut)
def get_dataset(dataset_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return owned_dataset(db, member, dataset_id)


@router.get("/{dataset_id}/rows", response_model=RowsOut)
def dataset_rows(
    dataset_id: str,
    page: int = Query(0, ge=0),
    size: int = Query(50, ge=1, le=500),
    sort: str | None = None,
    direction: Literal["asc", "desc"] = "asc",
    filters: str | None = Query(None, description='JSON list of {"field","op","value"}'),
    q: str | None = Query(None, max_length=200),
    member: WorkspaceMember = Depends(current_membership),
    db: Session = Depends(get_db),
):
    dataset = owned_dataset(db, member, dataset_id)
    try:
        parsed = json.loads(filters) if filters else []
        if not isinstance(parsed, list):
            raise ValueError
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Filters must be a JSON list") from None
    con = connect(member.workspace_id, [dataset])
    try:
        rows, total = page_rows(con, dataset, page, size, sort, direction, parsed, q)
    except QueryError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    finally:
        con.close()
    return RowsOut(rows=rows, total=total, page=page, size=size)


@router.get("/{dataset_id}/values/{column}", response_model=list[str])
def column_values(dataset_id: str, column: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    dataset = owned_dataset(db, member, dataset_id)
    con = connect(member.workspace_id, [dataset])
    try:
        return distinct_values(con, dataset, column)
    except QueryError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    finally:
        con.close()


@router.patch("/{dataset_id}", response_model=DatasetOut)
def update_dataset(
    dataset_id: str, body: DatasetPatch, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)
):
    require_editor(member)
    dataset = owned_dataset(db, member, dataset_id)
    if body.name is not None:
        name = body.name.strip()
        if name != dataset.name:
            dataset.name = _unique_name(db, member.workspace_id, name)
    if body.column_types:
        known = {c["name"] for c in dataset.columns}
        unknown = set(body.column_types) - known
        if unknown:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown column: {sorted(unknown)[0]}")
        if any(c.get("calculated") and c["name"] in body.column_types for c in dataset.columns):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A calculated column's type comes from its formula.")
        # New list so SQLAlchemy sees the JSON change. A retype resets what we knew about reading the old type.
        reset = ("format", "unreadable", "unreadable_examples")
        dataset.columns = [
            {k: v for k, v in c.items() if k not in reset} | {"type": body.column_types[c["name"]]}
            if c["name"] in body.column_types
            else c
            for c in dataset.columns
        ]
        # Text values marked as numbers or dates are read with the upload's rules; record what still can't be read.
        found = column_readability(dataset, list(body.column_types))
        dataset.columns = [{**c, **{k: v for k, v in found[c["name"]].items() if v}} if c["name"] in found else c for c in dataset.columns]
        refresh_calculated(db, dataset)
    if body.refresh is not None:
        if dataset.connection_id is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Only data from a connected database refreshes on a schedule.")
        dataset.refresh = body.refresh
    db.commit()
    db.refresh(dataset)
    return dataset


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dataset(dataset_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    dataset = owned_dataset(db, member, dataset_id)
    path = parquet_path(member.workspace_id, dataset.id)
    # Keep alerts on this data (they'll report the dataset as deleted) instead of relying on the
    # database cascade, which SQLite and Postgres treat differently.
    db.execute(update(Alert).where(Alert.dataset_id == dataset.id).values(dataset_id=None, state="error"))
    db.delete(dataset)
    db.commit()
    path.unlink(missing_ok=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{dataset_id}/file", response_model=DatasetOut)
def replace_file(
    dataset_id: str,
    file: UploadFile = File(...),
    sheet: str | None = Form(None),
    member: WorkspaceMember = Depends(current_membership),
    db: Session = Depends(get_db),
):
    """New data, same dataset: dashboards built on it keep working if the columns still match."""
    require_editor(member)
    dataset = owned_dataset(db, member, dataset_id)
    if dataset.connection_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This data comes from a connected database. Use Refresh now instead.")
    s = get_settings()
    filename = Path(file.filename or "").name
    raw = _read_capped(file, s.max_upload_bytes)
    check_quota(db, member.workspace_id, new_bytes=max(0, len(raw) - (dataset.file_size or 0)))
    db.close()  # don't hold a pooled connection while the file is parsed
    try:
        result = ingest(raw, filename, sheet=sheet or None, max_rows=s.max_upload_rows)
    except IngestError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    dataset = owned_dataset(db, member, dataset_id)  # closing the session detached it
    dataset.file_size = write_parquet(result.frame, parquet_path(member.workspace_id, dataset.id))
    dataset.source_filename = filename[:255]
    dataset.source_kind = Path(filename).suffix.lower().lstrip(".")
    dataset.sheet = result.sheet
    dataset.row_count = len(result.frame)
    dataset.columns = [c.as_dict() for c in result.columns]
    refresh_calculated(db, dataset)
    db.commit()
    db.refresh(dataset)
    return dataset


def _run_job_inline(bind, job_id: str) -> None:
    """Without Redis (local dev): run a claimed job in this process, after the response is sent."""
    from sqlalchemy.orm import Session as _Session

    from app import jobs

    db = _Session(bind)
    try:
        jobs.run_job(db, job_id)
    except Exception as e:
        jobs.mark_failed(db, job_id, e)
    finally:
        db.close()


@router.post("/{dataset_id}/sync", response_model=DatasetOut, status_code=status.HTTP_202_ACCEPTED)
def sync_now(
    dataset_id: str, background: BackgroundTasks,
    member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db),
):
    """Refresh a database-backed dataset now. Runs in the background; poll the dataset for `last_synced_at`."""
    require_editor(member)
    dataset = owned_dataset(db, member, dataset_id)
    if dataset.connection_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Only data from a connected database can be refreshed.")
    queue_sync(db, dataset, background)
    return dataset


def queue_sync(db: Session, dataset: Dataset, background: BackgroundTasks) -> bool:
    """Start a refresh of a connected dataset unless one is already running. True when one was queued.

    Shared by "Refresh now" and refresh hooks, so both claim the job slot the same way.
    """
    from app import jobs
    from app.sync import sync_in_progress

    run = None if sync_in_progress(dataset) else jobs.sync_now(db, dataset)
    if run is None:
        return False
    if get_settings().redis_url:
        from app.worker import run_job  # Celery only where it's configured

        run_job.delay(run.id)
    else:
        background.add_task(_run_job_inline, db.get_bind(), run.id)
    return True
