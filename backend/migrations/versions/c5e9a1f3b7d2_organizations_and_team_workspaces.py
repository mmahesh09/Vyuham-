"""organizations, team workspaces, hashed invitations and row-level security

Turns "one person, one workspace" into Organization -> Workspaces -> members, without changing any
existing id or deleting any data:

- Every existing workspace gets its own organization (same name, onboarding already complete).
- Roles: the earliest owner of each workspace becomes the organization's Owner; any other owners become
  Admins; editors become Analysts; viewers stay Viewers. Governance grants and policy exemptions that
  named "editor" now name "analyst".
- workspace_members.user_id is no longer unique: a person can belong to several workspaces.
- Invitations move to a new table that stores only a SHA-256 of the token. Open, emailed invites are
  carried over (sha256 of their token), so links already in people's inboxes keep working. Open
  invites without an email are dropped: invitations are email-bound now.
- Charts get workspace_id (from their dashboard); dashboards, saved queries and reports get
  updated_by and visibility (workspace | private, default workspace).
- On Postgres, row-level security is enabled and forced on the customer-data tables, with a policy
  that only shows rows of the workspace set in `app.workspace_id` (see app/tenancy.py and app/db.py).
  It only bites once the API connects as a role without SUPERUSER/BYPASSRLS (DEPLOY.md).

Downgrade removes the new columns and tables and recreates `invites`, but can't bring back plain-text
tokens: invitations created after the upgrade don't survive a downgrade.

Revision ID: c5e9a1f3b7d2
Revises: b3d8f2a6c914
Create Date: 2026-11-26 09:00:00.000000
"""
import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c5e9a1f3b7d2"
down_revision: Union[str, Sequence[str], None] = "b3d8f2a6c914"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Customer data protected by row-level security on Postgres. Each has a workspace_id column.
# Frozen here on purpose (app/rls.py is the live list; tests/test_rls.py checks they match today).
RLS_TABLES = [
    "datasets", "connections", "dashboards", "charts", "saved_queries", "reports", "report_runs",
    "alerts", "automations", "alert_events", "notifications", "tasks", "projects", "pipelines", "pipeline_runs",
    "dynamic_tables", "dynamic_refreshes", "semantic_metrics", "metric_versions", "metric_tests",
    "semantic_dimensions", "calculated_columns", "quality_rules", "quality_runs", "lineage_edges",
    "query_executions", "ai_actions", "cost_settings", "column_classifications", "governance_policies",
    "access_grants", "refresh_hooks", "leave_records", "feedback",
]
POLICY = "tenant_isolation"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return uuid.uuid4().hex


def _aware(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = datetime.fromisoformat(v.replace("Z", "+00:00"))
    return v if v.tzinfo else v.replace(tzinfo=timezone.utc)


def upgrade() -> None:
    bind = op.get_bind()
    pg = bind.dialect.name == "postgresql"

    # ---------- new tables ----------
    op.create_table(
        "organizations",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("company_size", sa.String(16)),
        sa.Column("industry", sa.String(60)),
        sa.Column("intended_use", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("plan", sa.String(16), nullable=False, server_default="free"),
        sa.Column("plan_status", sa.String(12), nullable=False, server_default="active"),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True)),
        sa.Column("seat_limit", sa.Integer()),
        sa.Column("onboarding_completed_at", sa.DateTime(timezone=True)),
        sa.Column("creation_key", sa.String(64)),
        sa.Column("created_by", sa.String(64), sa.ForeignKey("user.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("created_by", "creation_key", name="uq_organizations_creation_key"),
    )
    op.create_table(
        "organization_members",
        sa.Column("organization_id", sa.String(32), sa.ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.String(64), sa.ForeignKey("user.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="active"),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("removed_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_organization_members_user_id", "organization_members", ["user_id"])
    op.create_index(
        "uq_organization_owner", "organization_members", ["organization_id"], unique=True,
        postgresql_where=sa.text("role = 'owner' AND status = 'active'"),
        sqlite_where=sa.text("role = 'owner' AND status = 'active'"),
    )

    with op.batch_alter_table("workspaces") as b:
        b.add_column(sa.Column("organization_id", sa.String(32), nullable=True))
        b.add_column(sa.Column("description", sa.String(500)))
        b.add_column(sa.Column("logo_url", sa.String(500)))
        b.add_column(sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()))
        b.add_column(sa.Column("preferences", sa.JSON(), nullable=False, server_default="{}"))
        b.add_column(sa.Column("created_by", sa.String(64), nullable=True))
        b.add_column(sa.Column("updated_at", sa.DateTime(timezone=True)))
        b.add_column(sa.Column("deleted_at", sa.DateTime(timezone=True)))
        b.create_foreign_key("fk_workspaces_organization", "organizations", ["organization_id"], ["id"], ondelete="CASCADE")
        b.create_foreign_key("fk_workspaces_created_by", "user", ["created_by"], ["id"], ondelete="SET NULL")
        b.create_index("ix_workspaces_organization_id", ["organization_id"])

    op.create_table(
        "user_workspace_state",
        sa.Column("user_id", sa.String(64), sa.ForeignKey("user.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("current_workspace_id", sa.String(32), sa.ForeignKey("workspaces.id", ondelete="SET NULL")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "invitations",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("organization_id", sa.String(32), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workspace_id", sa.String(32), sa.ForeignKey("workspaces.id", ondelete="CASCADE")),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("invited_by", sa.String(64), sa.ForeignKey("user.id", ondelete="SET NULL")),
        sa.Column("accepted_by", sa.String(64), sa.ForeignKey("user.id", ondelete="SET NULL")),
        sa.Column("accepted_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_by", sa.String(64), sa.ForeignKey("user.id", ondelete="SET NULL")),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("last_sent_at", sa.DateTime(timezone=True)),
        sa.Column("send_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_invitations_organization_id", "invitations", ["organization_id"])
    op.create_index("ix_invitations_workspace_id", "invitations", ["workspace_id"])
    op.create_index(
        "uq_invitations_pending_email", "invitations", ["organization_id", "email"], unique=True,
        postgresql_where=sa.text("status = 'pending'"), sqlite_where=sa.text("status = 'pending'"),
    )

    # ---------- workspace_members: several workspaces per person ----------
    _drop_user_unique(bind, pg)
    with op.batch_alter_table("workspace_members") as b:
        b.add_column(sa.Column("updated_at", sa.DateTime(timezone=True)))
        b.create_index("ix_workspace_members_user_id", ["user_id"])

    with op.batch_alter_table("audit_logs") as b:
        b.add_column(sa.Column("organization_id", sa.String(32), nullable=True))
        b.alter_column("workspace_id", existing_type=sa.String(32), nullable=True)
        b.create_foreign_key("fk_audit_logs_organization", "organizations", ["organization_id"], ["id"], ondelete="CASCADE")
        b.create_index("ix_audit_logs_organization_id", ["organization_id"])

    for table in ("dashboards", "saved_queries", "reports"):
        with op.batch_alter_table(table) as b:
            b.add_column(sa.Column("updated_by", sa.String(64), nullable=True))
            b.add_column(sa.Column("visibility", sa.String(10), nullable=False, server_default="workspace"))
            b.create_foreign_key(f"fk_{table}_updated_by", "user", ["updated_by"], ["id"], ondelete="SET NULL")

    with op.batch_alter_table("charts") as b:
        b.add_column(sa.Column("workspace_id", sa.String(32), nullable=True))
        b.create_foreign_key("fk_charts_workspace", "workspaces", ["workspace_id"], ["id"], ondelete="CASCADE")
        b.create_index("ix_charts_workspace_id", ["workspace_id"])

    # ---------- data ----------
    _backfill(bind)

    if pg:
        _enable_rls(bind)


def _drop_user_unique(bind, pg: bool) -> None:
    insp = sa.inspect(bind)
    uniques = [u for u in insp.get_unique_constraints("workspace_members") if u["column_names"] == ["user_id"]]
    if pg:
        for u in uniques:
            op.drop_constraint(u["name"], "workspace_members", type_="unique")
        return
    # SQLite: the constraint has no name to drop, so rebuild the table without it.
    op.create_table(
        "_workspace_members_new",
        sa.Column("workspace_id", sa.String(32), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.String(64), sa.ForeignKey("user.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    bind.execute(sa.text(
        "INSERT INTO _workspace_members_new (workspace_id, user_id, role, created_at) "
        "SELECT workspace_id, user_id, role, created_at FROM workspace_members"
    ))
    op.drop_table("workspace_members")
    op.rename_table("_workspace_members_new", "workspace_members")


def _backfill(bind) -> None:
    now = _now()
    workspaces = bind.execute(sa.text("SELECT id, name, created_at FROM workspaces")).all()
    members = bind.execute(sa.text("SELECT workspace_id, user_id, role, created_at FROM workspace_members")).all()
    by_ws: dict[str, list] = {}
    for m in members:
        by_ws.setdefault(m.workspace_id, []).append(m)

    orgs = sa.table(
        "organizations", sa.column("id"), sa.column("name"), sa.column("intended_use", sa.JSON), sa.column("plan"),
        sa.column("plan_status"), sa.column("onboarding_completed_at"), sa.column("created_by"),
        sa.column("created_at"), sa.column("updated_at"),
    )
    org_members = sa.table(
        "organization_members", sa.column("organization_id"), sa.column("user_id"), sa.column("role"),
        sa.column("status"), sa.column("joined_at"), sa.column("updated_at"),
    )
    state = sa.table("user_workspace_state", sa.column("user_id"), sa.column("current_workspace_id"), sa.column("updated_at"))

    org_of: dict[str, str] = {}
    seen_users: set[str] = set()
    for ws in workspaces:
        ms = sorted(by_ws.get(ws.id, []), key=lambda m: (_aware(m.created_at) or now, m.user_id))
        owners = [m for m in ms if m.role == "owner"]
        first_owner = owners[0].user_id if owners else (ms[0].user_id if ms else None)
        org_id = _uuid()
        org_of[ws.id] = org_id
        created = _aware(ws.created_at) or now
        bind.execute(orgs.insert().values(
            id=org_id, name=ws.name, intended_use=[], plan="free", plan_status="active",
            onboarding_completed_at=now, created_by=first_owner, created_at=created, updated_at=now,
        ))
        bind.execute(sa.text(
            "UPDATE workspaces SET organization_id = :o, is_default = :t, created_by = :c, updated_at = :n WHERE id = :w"
        ), {"o": org_id, "t": True, "c": first_owner, "n": now, "w": ws.id})
        for m in ms:
            if m.user_id == first_owner:
                role = "owner"
            elif m.role == "owner":
                role = "admin"
            elif m.role == "editor":
                role = "analyst"
            elif m.role in ("admin", "analyst", "viewer"):
                role = m.role
            else:
                role = "viewer"
            bind.execute(org_members.insert().values(
                organization_id=org_id, user_id=m.user_id, role=role, status="active",
                joined_at=_aware(m.created_at) or now, updated_at=now,
            ))
            bind.execute(sa.text("UPDATE workspace_members SET role = :r, updated_at = :n WHERE workspace_id = :w AND user_id = :u"),
                         {"r": role, "n": now, "w": ws.id, "u": m.user_id})
            if m.user_id not in seen_users:
                seen_users.add(m.user_id)
                bind.execute(state.insert().values(user_id=m.user_id, current_workspace_id=ws.id, updated_at=now))

    # Audit rows and charts point at their organization / workspace.
    for ws_id, org_id in org_of.items():
        bind.execute(sa.text("UPDATE audit_logs SET organization_id = :o WHERE workspace_id = :w"), {"o": org_id, "w": ws_id})
    bind.execute(sa.text("UPDATE charts SET workspace_id = (SELECT d.workspace_id FROM dashboards d WHERE d.id = charts.dashboard_id)"))

    # Governance: "editor" is now "analyst".
    bind.execute(sa.text("UPDATE access_grants SET role = 'analyst' WHERE role = 'editor'"))
    for pid, rules in bind.execute(sa.text("SELECT id, rules FROM governance_policies")).all():
        data = json.loads(rules) if isinstance(rules, str) else (rules or {})
        exempt = data.get("exempt_roles")
        if exempt and "editor" in exempt:
            data["exempt_roles"] = ["analyst" if r == "editor" else r for r in exempt]
            bind.execute(sa.text("UPDATE governance_policies SET rules = :r WHERE id = :i"), {"r": json.dumps(data), "i": pid})

    # Open, emailed invites keep working: store the hash of their token.
    invitations = sa.table(
        "invitations", sa.column("id"), sa.column("organization_id"), sa.column("workspace_id"), sa.column("email"),
        sa.column("role"), sa.column("token_hash"), sa.column("status"), sa.column("expires_at"), sa.column("invited_by"),
        sa.column("send_count"), sa.column("created_at"), sa.column("updated_at"),
    )
    carried: set[tuple[str, str]] = set()
    for inv in bind.execute(sa.text(
        "SELECT token, workspace_id, role, email, created_by, created_at, expires_at FROM invites WHERE used_at IS NULL ORDER BY created_at DESC"
    )).all():
        expires = _aware(inv.expires_at)
        if not inv.email or expires is None or expires <= now or inv.workspace_id not in org_of:
            continue
        email = inv.email.strip().lower()
        org_id = org_of[inv.workspace_id]
        if (org_id, email) in carried:
            continue  # one open invitation per address
        carried.add((org_id, email))
        role = {"editor": "analyst", "owner": "admin"}.get(inv.role, inv.role if inv.role in ("admin", "analyst", "viewer") else "viewer")
        bind.execute(invitations.insert().values(
            id=_uuid(), organization_id=org_id, workspace_id=inv.workspace_id, email=email, role=role,
            token_hash=hashlib.sha256(inv.token.encode()).hexdigest(), status="pending", expires_at=expires,
            invited_by=inv.created_by, send_count=1, created_at=_aware(inv.created_at) or now, updated_at=now,
        ))
    op.drop_table("invites")


def _enable_rls(bind) -> None:
    existing = set(sa.inspect(bind).get_table_names())
    for table in RLS_TABLES:
        if table not in existing:
            continue
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
        op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{table}"')
        op.execute(
            f'CREATE POLICY {POLICY} ON "{table}" '
            "USING (current_setting('app.bypass_rls', true) = 'on' OR workspace_id = current_setting('app.workspace_id', true)) "
            "WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR workspace_id = current_setting('app.workspace_id', true))"
        )


def downgrade() -> None:
    bind = op.get_bind()
    pg = bind.dialect.name == "postgresql"
    if pg:
        existing = set(sa.inspect(bind).get_table_names())
        for table in RLS_TABLES:
            if table in existing:
                op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{table}"')
                op.execute(f'ALTER TABLE "{table}" NO FORCE ROW LEVEL SECURITY')
                op.execute(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY')

    op.create_table(
        "invites",
        sa.Column("token", sa.String(64), primary_key=True),
        sa.Column("workspace_id", sa.String(32), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("email", sa.String(320)),
        sa.Column("created_by", sa.String(64), sa.ForeignKey("user.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column("used_by", sa.String(64), sa.ForeignKey("user.id", ondelete="SET NULL")),
    )
    op.create_index("ix_invites_workspace_id", "invites", ["workspace_id"])

    # Roles back to owner | editor | viewer, and one workspace per person (their current one).
    bind.execute(sa.text("UPDATE workspace_members SET role = 'owner' WHERE role = 'admin'"))
    bind.execute(sa.text("UPDATE workspace_members SET role = 'editor' WHERE role = 'analyst'"))
    bind.execute(sa.text("UPDATE access_grants SET role = 'editor' WHERE role = 'analyst'"))
    rows = bind.execute(sa.text(
        "SELECT wm.user_id, wm.workspace_id, s.current_workspace_id FROM workspace_members wm "
        "LEFT JOIN user_workspace_state s ON s.user_id = wm.user_id ORDER BY wm.created_at"
    )).all()
    keep: dict[str, str] = {}
    for uid, ws_id, current in rows:  # their current workspace, else the first they joined
        keep.setdefault(uid, ws_id)
        if current == ws_id:
            keep[uid] = ws_id
    for uid, ws_id, _ in rows:
        if keep.get(uid) != ws_id:
            bind.execute(sa.text("DELETE FROM workspace_members WHERE user_id = :u AND workspace_id = :w"), {"u": uid, "w": ws_id})

    with op.batch_alter_table("charts") as b:
        b.drop_index("ix_charts_workspace_id")
        b.drop_constraint("fk_charts_workspace", type_="foreignkey")
        b.drop_column("workspace_id")
    for table in ("dashboards", "saved_queries", "reports"):
        with op.batch_alter_table(table) as b:
            b.drop_constraint(f"fk_{table}_updated_by", type_="foreignkey")
            b.drop_column("visibility")
            b.drop_column("updated_by")
    bind.execute(sa.text("DELETE FROM audit_logs WHERE workspace_id IS NULL"))
    with op.batch_alter_table("audit_logs") as b:
        b.drop_index("ix_audit_logs_organization_id")
        b.drop_constraint("fk_audit_logs_organization", type_="foreignkey")
        b.drop_column("organization_id")
        b.alter_column("workspace_id", existing_type=sa.String(32), nullable=False)
    with op.batch_alter_table("workspace_members") as b:
        b.drop_index("ix_workspace_members_user_id")
        b.drop_column("updated_at")
        b.create_unique_constraint("uq_workspace_members_user_id", ["user_id"])
    op.drop_table("invitations")
    op.drop_table("user_workspace_state")
    with op.batch_alter_table("workspaces") as b:
        b.drop_index("ix_workspaces_organization_id")
        b.drop_constraint("fk_workspaces_created_by", type_="foreignkey")
        b.drop_constraint("fk_workspaces_organization", type_="foreignkey")
        for col in ("deleted_at", "updated_at", "created_by", "preferences", "is_default", "logo_url", "description", "organization_id"):
            b.drop_column(col)
    op.drop_index("uq_organization_owner", "organization_members")
    op.drop_index("ix_organization_members_user_id", "organization_members")
    op.drop_table("organization_members")
    op.drop_table("organizations")
