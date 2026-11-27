"""Postgres row-level security: which tables are protected and the policy on them.

Migration c5e9a1f3b7d2 created these policies (with its own frozen copy of this list). A new table
that holds customer data with a `workspace_id` must be added here AND get the policy in its own
migration; tests/test_rls.py fails if a workspace-scoped table is in neither list below.
"""

from __future__ import annotations

POLICY = "tenant_isolation"

PROTECTED = (
    "datasets", "connections", "dashboards", "charts", "saved_queries", "reports", "report_runs",
    "alerts", "automations", "alert_events", "notifications", "tasks", "projects", "pipelines", "pipeline_runs",
    "dynamic_tables", "dynamic_refreshes", "semantic_metrics", "metric_versions", "metric_tests",
    "semantic_dimensions", "calculated_columns", "quality_rules", "quality_runs", "lineage_edges",
    "query_executions", "ai_actions", "cost_settings", "column_classifications", "governance_policies",
    "access_grants", "refresh_hooks", "leave_records", "feedback",
)

# Have a workspace_id but are filtered by the app instead, with the reason.
NOT_PROTECTED = {
    "workspace_members": "membership itself: read before the request's workspace is known",
    "invitations": "organization-level; read by token hash before sign-in",
    "audit_logs": "organization-level rows have no workspace",
    "support_tickets": "Vyuham staff read every ticket",
    "ticket_attachments": "Vyuham staff read every ticket",
    "user_workspace_state": "a per-person preference (current_workspace_id, not workspace_id)",
}


def policy_sql(table: str) -> list[str]:
    check = (
        "current_setting('app.bypass_rls', true) = 'on' "
        "OR workspace_id = current_setting('app.workspace_id', true)"
    )
    return [
        f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY',
        f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY',
        f'DROP POLICY IF EXISTS {POLICY} ON "{table}"',
        f'CREATE POLICY {POLICY} ON "{table}" USING ({check}) WITH CHECK ({check})',
    ]
