"""SQL Lab: read-only SQL over the workspace's datasets, plus saved queries (owners and editors)."""

import time

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Dataset, SavedQuery, WorkspaceMember
from app.query import MAX_ROWS, QueryError, connect, run_sql, table_names
from app.routers.datasets import CAN_UPLOAD
from app.schemas import ColumnOut, UtcDatetime
from app.security import current_membership

router = APIRouter(prefix="/sql", tags=["sql"])


def _editor(member: WorkspaceMember) -> None:
    if member.role not in CAN_UPLOAD:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "SQL Lab is for owners and editors.")


def _datasets(db: Session, member: WorkspaceMember) -> list[Dataset]:
    return list(db.scalars(select(Dataset).where(Dataset.workspace_id == member.workspace_id).order_by(Dataset.created_at)))


class TableOut(BaseModel):
    table: str
    dataset_id: str
    dataset_name: str
    row_count: int
    columns: list[ColumnOut]


class RunIn(BaseModel):
    sql: str = Field(min_length=1, max_length=10_000)


class RunOut(BaseModel):
    columns: list[str]
    rows: list[dict]
    row_count: int
    truncated: bool
    elapsed_ms: int


class SavedIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sql: str = Field(min_length=1, max_length=10_000)


class SavedOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    name: str
    sql: str
    created_at: UtcDatetime
    updated_at: UtcDatetime


@router.get("/schema", response_model=list[TableOut])
def schema(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    datasets = _datasets(db, member)
    names = table_names(datasets)
    return [TableOut(table=names[d.id], dataset_id=d.id, dataset_name=d.name, row_count=d.row_count, columns=d.columns) for d in datasets]


@router.post("/run", response_model=RunOut)
def run(body: RunIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    con = connect(member.workspace_id, _datasets(db, member))
    started = time.perf_counter()
    try:
        rows = run_sql(con, body.sql)
    except QueryError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    finally:
        con.close()
    columns = list(rows[0].keys()) if rows else []
    return RunOut(columns=columns, rows=rows, row_count=len(rows), truncated=len(rows) >= MAX_ROWS,
                  elapsed_ms=int((time.perf_counter() - started) * 1000))


@router.get("/saved", response_model=list[SavedOut])
def list_saved(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    return db.scalars(select(SavedQuery).where(SavedQuery.workspace_id == member.workspace_id).order_by(SavedQuery.updated_at.desc())).all()


@router.post("/saved", response_model=SavedOut, status_code=status.HTTP_201_CREATED)
def save(body: SavedIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    q = SavedQuery(workspace_id=member.workspace_id, name=body.name.strip(), sql=body.sql, created_by=member.user_id)
    db.add(q)
    db.commit()
    db.refresh(q)
    return q


def _saved(db: Session, member: WorkspaceMember, qid: str) -> SavedQuery:
    q = db.get(SavedQuery, qid)
    if q is None or q.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Query not found")
    return q


@router.put("/saved/{qid}", response_model=SavedOut)
def update_saved(qid: str, body: SavedIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    q = _saved(db, member, qid)
    q.name, q.sql = body.name.strip(), body.sql
    db.commit()
    db.refresh(q)
    return q


@router.delete("/saved/{qid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved(qid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    db.delete(_saved(db, member, qid))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
