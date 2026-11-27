"""Shared and private workspace assets (dashboards, saved queries, reports).

Assets belong to the workspace, not to the person who made it: `created_by` is attribution only, and
anyone in the workspace finds a "workspace" asset. A "private" asset is visible to its creator and to
owners and admins (who oversee everything in the workspace); for everyone else it doesn't exist (404).
"""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import or_, true

from app.permissions import FULL_ACCESS

Visibility = Literal["workspace", "private"]


def visible_clause(model, member):
    """A WHERE clause for the assets this member may see (use with the workspace filter, not instead of it)."""
    if member.role in FULL_ACCESS:
        return true()
    return or_(model.visibility == "workspace", model.visibility.is_(None), model.created_by == member.user_id)


def can_see(obj, member) -> bool:
    if member.role in FULL_ACCESS or obj.created_by == member.user_id:
        return True
    return (obj.visibility or "workspace") == "workspace"


def ensure_visible(obj, member, what: str = "Not found") -> None:
    if not can_see(obj, member):
        raise HTTPException(status.HTTP_404_NOT_FOUND, what)


def set_visibility(obj, member, visibility: str | None) -> None:
    """Only the creator (or an owner/admin) decides who sees an asset."""
    if visibility is None or visibility == (obj.visibility or "workspace"):
        return
    if obj.created_by != member.user_id and member.role not in FULL_ACCESS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who made this (or an admin) can change who sees it.")
    obj.visibility = visibility


def touched(obj, member) -> None:
    obj.updated_by = member.user_id
