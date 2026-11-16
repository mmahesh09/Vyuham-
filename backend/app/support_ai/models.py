"""Tables for the AI troubleshooting engine (docs/rag-support-engine.md).

Tenant data (errors, sessions, tenant knowledge) always carries `workspace_id`. Global knowledge has
no workspace. Every read path filters by workspace in SQL; see search.visible_articles().
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator, UserDefinedType

from app.db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class _PgVector(UserDefinedType):
    cache_ok = True

    def __init__(self, dim: int):
        self.dim = dim

    def get_col_spec(self, **_kw) -> str:
        return f"vector({self.dim})"


class Vector(TypeDecorator):
    """pgvector `vector(n)` on PostgreSQL; JSON text elsewhere (SQLite in dev and tests)."""

    impl = Text
    cache_ok = True

    def __init__(self, dim: int):
        super().__init__()
        self.dim = dim

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(_PgVector(self.dim) if dialect.name == "postgresql" else Text())

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if len(value) != self.dim:
            raise ValueError(f"embedding has {len(value)} dimensions, expected {self.dim}")
        return "[" + ",".join(f"{float(x):.7g}" for x in value) + "]" if dialect.name == "postgresql" else json.dumps(list(map(float, value)))

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return [float(x) for x in (value.strip("[]").split(",") if dialect.name == "postgresql" else json.loads(value))]


EMBEDDING_DIM = 1024  # keep in sync with settings.embedding_dimensions and the migration


class SupportErrorGroup(Base):
    """Errors in one workspace with the same fingerprint (duplicates grouped)."""

    __tablename__ = "support_error_groups"
    __table_args__ = (UniqueConstraint("workspace_id", "fingerprint", name="uq_support_error_group"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    module: Mapped[str] = mapped_column(String(32))
    category: Mapped[str] = mapped_column(String(48))
    error_type: Mapped[str] = mapped_column(String(120))
    normalized_message: Mapped[str] = mapped_column(String(500))
    sample_message: Mapped[str] = mapped_column(String(2000))  # redacted
    count: Mapped[int] = mapped_column(Integer, default=1)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class SupportErrorEvent(Base):
    """One occurrence, already redacted."""

    __tablename__ = "support_error_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[str] = mapped_column(ForeignKey("support_error_groups.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("user.id", ondelete="CASCADE"), index=True)
    message: Mapped[str] = mapped_column(String(2000))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class KnowledgeArticle(Base):
    """A troubleshooting article. Only `approved` articles are ever retrieved.

    scope=global: shared with every customer; workspace_id is NULL. Must be approved by staff as tested.
    scope=tenant: private to one workspace.
    """

    __tablename__ = "knowledge_articles"
    __table_args__ = (
        CheckConstraint(
            "(scope = 'global' AND workspace_id IS NULL) OR (scope = 'tenant' AND workspace_id IS NOT NULL)",
            name="ck_knowledge_scope_workspace",
        ),
        CheckConstraint("status IN ('pending', 'approved', 'rejected', 'archived')", name="ck_knowledge_status"),
        CheckConstraint("status <> 'approved' OR tested", name="ck_knowledge_approved_is_tested"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    scope: Mapped[str] = mapped_column(String(8))
    workspace_id: Mapped[str | None] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    symptoms: Mapped[str] = mapped_column(Text)
    root_cause: Mapped[str] = mapped_column(Text)
    resolution: Mapped[str] = mapped_column(Text)
    modules: Mapped[list] = mapped_column(JSON, default=list)
    categories: Mapped[list] = mapped_column(JSON, default=list)
    fingerprints: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(10), default="pending", index=True)
    tested: Mapped[bool] = mapped_column(Boolean, default=False)
    test_notes: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(24), default="staff")  # staff | customer_feedback | promotion
    source_ref: Mapped[str | None] = mapped_column(String(32))  # session or article it came from
    helpful_count: Mapped[int] = mapped_column(Integer, default=0)
    unhelpful_count: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str | None] = mapped_column(String(64))
    reviewed_by: Mapped[str | None] = mapped_column(String(64))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class KnowledgeEmbedding(Base):
    """The embedding of an approved article, for one embedding model."""

    __tablename__ = "knowledge_embeddings"
    __table_args__ = (
        # Approximate nearest-neighbour index for cosine distance (pgvector). PostgreSQL only.
        Index("ix_knowledge_embeddings_hnsw", "embedding", postgresql_using="hnsw", postgresql_ops={"embedding": "vector_cosine_ops"}).ddl_if(dialect="postgresql"),
    )

    article_id: Mapped[str] = mapped_column(ForeignKey("knowledge_articles.id", ondelete="CASCADE"), primary_key=True)
    model: Mapped[str] = mapped_column(String(64))
    content_hash: Mapped[str] = mapped_column(String(64))
    embedding: Mapped[list] = mapped_column(Vector(EMBEDDING_DIM))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class SupportAiSession(Base):
    """One question to the assistant and its answer. Visible only to the person who asked."""

    __tablename__ = "support_ai_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    thread_id: Mapped[str] = mapped_column(String(32), index=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("user.id", ondelete="CASCADE"), index=True)
    module: Mapped[str] = mapped_column(String(32))
    question: Mapped[str] = mapped_column(String(2000))  # redacted
    error_group_id: Mapped[str | None] = mapped_column(ForeignKey("support_error_groups.id", ondelete="SET NULL"))
    context: Mapped[dict] = mapped_column(JSON, default=dict)  # redacted, only what the customer chose to share
    status: Mapped[str] = mapped_column(String(10), default="queued")  # queued | running | answered | failed
    answer: Mapped[dict | None] = mapped_column(JSON)
    model: Mapped[str | None] = mapped_column(String(64))
    usage: Mapped[dict] = mapped_column(JSON, default=dict)
    failure: Mapped[str | None] = mapped_column(String(300))  # safe, customer-facing
    feedback: Mapped[str | None] = mapped_column(String(10))  # resolved | unresolved
    feedback_comment: Mapped[str | None] = mapped_column(String(1000))
    feedback_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    escalated_conversation_id: Mapped[int | None] = mapped_column(Integer)
    escalated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SupportAiReference(Base):
    """Which articles were retrieved for a session, as they were at the time."""

    __tablename__ = "support_ai_references"

    session_id: Mapped[str] = mapped_column(ForeignKey("support_ai_sessions.id", ondelete="CASCADE"), primary_key=True)
    article_id: Mapped[str] = mapped_column(ForeignKey("knowledge_articles.id", ondelete="CASCADE"), primary_key=True)
    rank: Mapped[int] = mapped_column(Integer)
    score: Mapped[float] = mapped_column(Float)
    scope: Mapped[str] = mapped_column(String(8))
    cited: Mapped[bool] = mapped_column(Boolean, default=False)


class SupportJob(Base):
    """Background work: embeddings and answers. Polled by the worker (jobs.py)."""

    __tablename__ = "support_jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String(24))  # embed_article | answer_session
    ref_id: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(10), default="queued", index=True)  # queued | running | done | failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    last_error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
