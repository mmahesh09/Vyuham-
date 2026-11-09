"""Better Auth's core tables (better-auth 1.7), declared here so Alembic owns the schema
and app tables can reference "user". Better Auth writes these rows; this app only reads them.
Column names are Better Auth's defaults (camelCase). Keep in sync with frontend/src/lib/auth.ts
(e.g. the extra `company` field on user).
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Table, Text

from app.db import Base

ts = lambda name, nullable=False: Column(name, DateTime(timezone=True), nullable=nullable)  # noqa: E731

user_table = Table(
    "user",
    Base.metadata,
    Column("id", String(64), primary_key=True),
    Column("name", Text, nullable=False),
    Column("email", String(320), nullable=False, unique=True),
    Column("emailVerified", Boolean, nullable=False, default=False),
    Column("image", Text),
    Column("company", String(120)),
    Column("privacyConsentVersion", String(32)),  # policy version agreed to at sign-up (DPDP Act s.6(10))
    ts("createdAt"),
    ts("updatedAt"),
)

session_table = Table(
    "session",
    Base.metadata,
    Column("id", String(64), primary_key=True),
    ts("expiresAt"),
    Column("token", String(255), nullable=False, unique=True),
    ts("createdAt"),
    ts("updatedAt"),
    Column("ipAddress", Text),
    Column("userAgent", Text),
    Column("userId", String(64), ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True),
)

account_table = Table(
    "account",
    Base.metadata,
    Column("id", String(64), primary_key=True),
    Column("accountId", Text, nullable=False),
    Column("providerId", Text, nullable=False),
    Column("userId", String(64), ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("accessToken", Text),
    Column("refreshToken", Text),
    Column("idToken", Text),
    ts("accessTokenExpiresAt", True),
    ts("refreshTokenExpiresAt", True),
    Column("scope", Text),
    Column("password", Text),
    ts("createdAt"),
    ts("updatedAt"),
)

verification_table = Table(
    "verification",
    Base.metadata,
    Column("id", String(64), primary_key=True),
    Column("identifier", Text, nullable=False, index=True),
    Column("value", Text, nullable=False),
    ts("expiresAt"),
    ts("createdAt"),
    ts("updatedAt"),
)
