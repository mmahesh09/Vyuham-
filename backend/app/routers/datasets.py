import json
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.ingest import IngestError, ingest, write_parquet
from app.models import Alert, Dataset, WorkspaceMember
from app.query import QueryError, connect, distinct_values, page_rows
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
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"This file is over {limit // (1024 * 1024)} MB. The beta limit is {limit // (1024 * 1024)} MB.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


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
    filename = Path(file.filename or "").name  # never trust a client path
    raw = _read_capped(file, s.max_upload_bytes)
    try:
        result = ingest(raw, filename, sheet=sheet or None, max_rows=s.max_upload_rows)
    except IngestError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e

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
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Filters must be a JSON list") from None
    con = connect(member.workspace_id, [dataset])
    try:
        rows, total = page_rows(con, dataset, page, size, sort, direction, parsed, q)
    except QueryError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
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
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown column: {sorted(unknown)[0]}")
        # New list so SQLAlchemy sees the JSON change.
        dataset.columns = [{**c, "type": body.column_types.get(c["name"], c["type"])} for c in dataset.columns]
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
    s = get_settings()
    filename = Path(file.filename or "").name
    raw = _read_capped(file, s.max_upload_bytes)
    try:
        result = ingest(raw, filename, sheet=sheet or None, max_rows=s.max_upload_rows)
    except IngestError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    dataset.file_size = write_parquet(result.frame, parquet_path(member.workspace_id, dataset.id))
    dataset.source_filename = filename[:255]
    dataset.source_kind = Path(filename).suffix.lower().lstrip(".")
    dataset.sheet = result.sheet
    dataset.row_count = len(result.frame)
    dataset.columns = [c.as_dict() for c in result.columns]
    db.commit()
    db.refresh(dataset)
    return dataset
