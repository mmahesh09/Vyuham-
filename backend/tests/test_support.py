"""Support tickets, the help center, GlitchTip error groups and the help shown for known errors."""

import pytest

from app.config import get_settings
from app.errors import normalize_title
from tests.conftest import add_user

TICKET = {"subject": "Chart shows zero revenue", "body": "My revenue chart shows 0 since I uploaded the March sheet.", "category": "bug"}
SECRET = "test-webhook-secret"


@pytest.fixture(autouse=True)
def staff_settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "support_staff_emails", "staff@acme.co")
    monkeypatch.setattr(s, "glitchtip_webhook_secret", SECRET)


def login(client, engine, uid, **kw):
    """Sign in as `uid` (created on first use). Staff is uid 'staff' -> staff@acme.co."""
    token = f"tok-{uid}"
    try:
        add_user(engine, uid=uid, token=token, **kw)
    except Exception:
        pass  # already exists
    client.cookies.set("better-auth.session_token", f"{token}.c2ln")
    client.get("/me")


def make_ticket(client, engine, uid="u1", **over):
    login(client, engine, uid)
    r = client.post("/support/tickets", json={**TICKET, **over})
    assert r.status_code == 201, r.text
    return r.json()


def glitchtip(issue_id: str, title: str, culprit: str = "app.query in run"):
    return {
        "alias": "GlitchTip",
        "text": "GlitchTip Alert",
        "attachments": [{"title": title, "title_link": f"https://errors.example.com/acme/issues/{issue_id}", "text": culprit, "color": "#e52b50"}],
    }


# --- Tickets -----------------------------------------------------------------------------------


def test_ticket_needs_sign_in(client):
    assert client.post("/support/tickets", json=TICKET).status_code == 401


def test_ticket_lifecycle(client, engine):
    t = make_ticket(client, engine)
    assert t["status"] == "open" and len(t["messages"]) == 1

    login(client, engine, "staff")
    assert client.get("/me").json()["is_staff"] is True
    r = client.post(f"/support/admin/tickets/{t['id']}/messages", json={"body": "Internal: looks like the date column", "internal": True})
    assert r.status_code == 200
    r = client.post(f"/support/admin/tickets/{t['id']}/messages", json={"body": "Your date column has two formats. Fix it and re-upload."})
    body = r.json()
    assert body["status"] == "pending" and body["first_response_at"]

    login(client, engine, "u1")
    mine = client.get(f"/support/tickets/{t['id']}").json()
    assert [m["is_staff"] for m in mine["messages"]] == [False, True]  # internal note hidden
    assert all(not m["internal"] for m in mine["messages"])
    r = client.post(f"/support/tickets/{t['id']}/messages", json={"body": "Still zero after re-uploading"})
    assert r.json()["status"] == "open"
    assert client.post(f"/support/tickets/{t['id']}/resolve").json()["status"] == "resolved"


def test_other_workspace_cannot_see_ticket(client, engine):
    t = make_ticket(client, engine)
    login(client, engine, "u2", company="Other Co")
    assert client.get(f"/support/tickets/{t['id']}").status_code == 404
    assert client.post(f"/support/tickets/{t['id']}/messages", json={"body": "hi"}).status_code == 404
    assert client.get("/support/tickets").json() == []


def test_admin_routes_hidden_from_customers(client, engine):
    make_ticket(client, engine)
    for path in ("/support/admin/tickets", "/support/admin/errors", "/support/admin/metrics", "/kb/admin/articles", "/status/admin/incidents"):
        assert client.get(path).status_code == 404, path
    assert client.get("/me").json()["is_staff"] is False


def test_ticket_validation(client, engine):
    login(client, engine, "u1")
    assert client.post("/support/tickets", json={**TICKET, "subject": "x"}).status_code == 422
    assert client.post("/support/tickets", json={**TICKET, "category": "spam"}).status_code == 422
    assert client.post("/support/tickets", json={**TICKET, "error_event_id": "<script>"}).status_code == 422


def test_staff_inbox_filters_and_metrics(client, engine):
    t = make_ticket(client, engine)
    make_ticket(client, engine, subject="Can I invite my accountant?", category="question")
    login(client, engine, "staff")
    assert len(client.get("/support/admin/tickets?status=active").json()) == 2
    found = client.get("/support/admin/tickets?q=revenue").json()
    assert [x["id"] for x in found] == [t["id"]] and found[0]["requester_email"] == "u1@acme.co"
    client.patch(f"/support/admin/tickets/{t['id']}", json={"status": "closed"})
    assert len(client.get("/support/admin/tickets?status=active").json()) == 1
    m = client.get("/support/admin/metrics").json()
    assert m["tickets_this_week"] == 2 and m["open_tickets"] == 1


# --- Ticket -> article -> help center ----------------------------------------------------------


def test_ticket_to_article_then_search(client, engine):
    t = make_ticket(client, engine)
    login(client, engine, "staff")
    client.post(f"/support/admin/tickets/{t['id']}/messages", json={"body": "Make every date in the column use one format."})
    a = client.post(f"/support/admin/tickets/{t['id']}/to-article").json()
    assert a["status"] == "draft" and "## The fix" in a["body"] and a["slug"] == "chart-shows-zero-revenue"
    # A second click returns the same draft.
    assert client.post(f"/support/admin/tickets/{t['id']}/to-article").json()["id"] == a["id"]

    # Drafts are not public.
    assert client.get(f"/kb/articles/{a['slug']}").status_code == 404
    assert client.get("/kb/search?q=zero revenue").json() == []

    r = client.put(f"/kb/admin/articles/{a['id']}", json={"title": a["title"], "summary": "Dates in two formats", "body": a["body"], "tags": ["Charts"], "status": "published"})
    assert r.status_code == 200 and r.json()["published_at"] and r.json()["tags"] == ["charts"]

    client.cookies.clear()  # the help center is public
    hits = client.get("/kb/search?q=revenue chart zero").json()
    assert [h["slug"] for h in hits] == [a["slug"]]
    assert client.get(f"/kb/articles/{a['slug']}").status_code == 200
    assert client.post(f"/kb/articles/{a['slug']}/feedback", json={"helpful": True}).status_code == 204
    assert [x["slug"] for x in client.get("/kb?tag=charts").json()] == [a["slug"]]


def test_slug_conflict_and_delete(client, engine):
    login(client, engine, "staff")
    a = client.post("/kb/admin/articles", json={"title": "Upload limits", "status": "published"}).json()
    b = client.post("/kb/admin/articles", json={"title": "Upload limits", "status": "draft"}).json()
    assert b["slug"] == "upload-limits-2"
    assert client.put(f"/kb/admin/articles/{b['id']}", json={"title": "x x x", "slug": a["slug"]}).status_code == 409
    assert client.delete(f"/kb/admin/articles/{a['id']}").status_code == 204
    assert client.get(f"/kb/articles/{a['slug']}").status_code == 404


def test_deflection_counts(client, engine):
    login(client, engine, "staff")
    a = client.post("/kb/admin/articles", json={"title": "Fix dates", "status": "published"}).json()
    login(client, engine, "u1")
    assert client.post("/kb/deflections", json={"article_id": a["id"]}).status_code == 204
    login(client, engine, "staff")
    m = client.get("/support/admin/metrics").json()
    assert m["deflections_this_week"] == 1 and m["deflection_rate"] == 1.0


def test_ticket_list_shows_latest_visible_reply(client, engine):
    t = make_ticket(client, engine)
    row = client.get("/support/tickets").json()[0]
    assert row["staff_replied"] is False
    assert row["latest_reply"]["is_staff"] is False and row["latest_reply"]["excerpt"].startswith("My revenue chart")

    login(client, engine, "staff")
    client.post(f"/support/admin/tickets/{t['id']}/messages", json={"body": "Checking the upload now."})
    client.post(f"/support/admin/tickets/{t['id']}/messages", json={"body": "Secret internal note", "internal": True})

    login(client, engine, "u1")
    row = client.get("/support/tickets").json()[0]
    # The internal note is newer but never shown: the latest reply is the public staff message.
    assert row["staff_replied"] is True and row["status"] == "pending"
    assert row["latest_reply"] == {**row["latest_reply"], "is_staff": True, "excerpt": "Checking the upload now."}


def test_popular_only_lists_articles_people_used(client, engine):
    login(client, engine, "staff")
    body = " ".join(["word"] * 650)
    a = client.post("/kb/admin/articles", json={"title": "Fix dates", "body": body, "status": "published"}).json()
    b = client.post("/kb/admin/articles", json={"title": "Share a link", "status": "published"}).json()
    client.cookies.clear()
    assert client.get("/kb/popular").json() == []  # no usage yet: nothing is called popular

    client.post(f"/kb/articles/{b['slug']}/feedback", json={"helpful": True})
    login(client, engine, "u1")
    client.post("/kb/deflections", json={"article_id": a["id"]})
    client.post("/kb/deflections", json={"article_id": a["id"]})
    client.cookies.clear()
    popular = client.get("/kb/popular").json()
    assert [p["slug"] for p in popular] == [a["slug"], b["slug"]]
    assert popular[0]["read_minutes"] == 3 and popular[1]["read_minutes"] == 1


# --- GlitchTip webhook and error help ----------------------------------------------------------


def test_webhook_rejects_bad_secret_and_big_bodies(client):
    assert client.post("/support/webhooks/glitchtip?secret=nope", json=glitchtip("1", "KeyError: x")).status_code == 401
    assert client.post("/support/webhooks/glitchtip", json=glitchtip("1", "KeyError: x")).status_code == 401
    big = {"attachments": [], "pad": "x" * 70_000}
    assert client.post(f"/support/webhooks/glitchtip?secret={SECRET}", json=big).status_code == 413
    assert client.post(f"/support/webhooks/glitchtip?secret={SECRET}", content=b"not json").status_code == 400


def test_webhook_off_without_secret(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "glitchtip_webhook_secret", "")
    assert client.post("/support/webhooks/glitchtip?secret=", json=glitchtip("1", "KeyError: x")).status_code == 401


def test_webhook_groups_and_dedupes(client, engine):
    url = f"/support/webhooks/glitchtip?secret={SECRET}"
    assert client.post(url, json=glitchtip("42", "KeyError: 'revenue'")).status_code == 204
    assert client.post(url, json=glitchtip("42", "KeyError: 'revenue'")).status_code == 204
    client.post(url, headers={"X-Webhook-Secret": SECRET}, json=glitchtip("43", "ValueError: bad date"))
    login(client, engine, "staff")
    groups = client.get("/support/admin/errors").json()
    assert {g["glitchtip_issue_id"]: g["count"] for g in groups} == {"42": 2, "43": 1}
    assert all(g["status"] == "new" for g in groups)


def test_known_error_points_to_article(client, engine):
    client.post(f"/support/webhooks/glitchtip?secret={SECRET}", json=glitchtip("7", "KeyError: 'col_17' not found in row 4"))
    login(client, engine, "staff")
    g = client.get("/support/admin/errors").json()[0]
    a = client.post("/kb/admin/articles", json={"title": "Missing column after re-upload", "summary": "Rename the column back", "status": "published"}).json()
    patched = client.patch(f"/support/admin/errors/{g['id']}", json={"kb_article_id": a["id"]}).json()
    assert patched["status"] == "known"

    client.cookies.clear()
    # Same error, different ids: still matches.
    hit = client.get("/support/errors/help", params={"title": "KeyError: 'col_2' not found in row 9"}).json()
    assert hit["slug"] == a["slug"]
    assert client.get("/support/errors/help", params={"title": "TypeError: something else"}).json() is None


def test_normalize_title():
    assert normalize_title("KeyError: 'abc' at 12") == normalize_title("KeyError: 'xyz' at 99")
    assert normalize_title("Dataset 3f2a9c0e8b7d4e6fa1b2c3d4e5f60718 missing") == normalize_title("Dataset 0123456789abcdef0123456789abcdef missing")


def test_unhandled_error_returns_reference_and_help(client, engine):
    from fastapi.testclient import TestClient

    from app.main import app

    def boom():
        raise LookupError("dataset 'sales_2026' has no column 'amount'")

    if not any(getattr(r, "path", "") == "/__test_boom" for r in app.routes):
        app.add_api_route("/__test_boom", boom)

    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/__test_boom")
        assert r.status_code == 500
        body = r.json()
        assert body["error_ref"] and body["help"] is None and "sales_2026" not in r.text

        # Once staff link the matching GlitchTip issue to an article, the 500 points at it.
        c.post(f"/support/webhooks/glitchtip?secret={SECRET}", json=glitchtip("9", "LookupError: dataset 'x' has no column 'y'"))
        login(c, engine, "staff")
        g = c.get("/support/admin/errors").json()[0]
        a = c.post("/kb/admin/articles", json={"title": "Column missing after re-upload", "status": "published"}).json()
        c.patch(f"/support/admin/errors/{g['id']}", json={"kb_article_id": a["id"]})
        assert c.get("/__test_boom").json()["help"]["slug"] == a["slug"]


# --- Attachments -------------------------------------------------------------------------------

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def upload(client, name="screen.png", data=PNG, ctype="image/png"):
    return client.post("/support/attachments", files={"file": (name, data, ctype)})


def test_attachment_on_new_ticket_and_download(client, engine):
    login(client, engine, "u1")
    r = upload(client)
    assert r.status_code == 201, r.text
    att = r.json()
    assert att["content_type"] == "image/png" and att["size"] == len(PNG)

    r = client.post("/support/tickets", json={**TICKET, "attachment_ids": [att["id"]]})
    assert r.status_code == 201, r.text
    assert [a["id"] for a in r.json()["messages"][0]["attachments"]] == [att["id"]]

    r = client.get(f"/support/attachments/{att['id']}")
    assert r.status_code == 200 and r.content == PNG
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-disposition"].startswith("inline")

    # Already used: can't be attached to a second message.
    t = client.get("/support/tickets").json()[0]
    r = client.post(f"/support/tickets/{t['id']}/messages", json={"body": "again", "attachment_ids": [att["id"]]})
    assert r.status_code == 400


def test_attachment_type_and_size_checks(client, engine):
    login(client, engine, "u1")
    assert upload(client, "run.exe", b"MZ...", "application/octet-stream").status_code == 400
    assert upload(client, "fake.png", b"not really a png").status_code == 400  # contents don't match
    assert upload(client, "notes.txt", b"bin\x00ary", "text/plain").status_code == 400
    assert upload(client, "empty.csv", b"", "text/csv").status_code == 400
    big = b"a" * (10 * 1024 * 1024 + 1)
    assert upload(client, "big.txt", big, "text/plain").status_code == 413
    r = upload(client, "../../etc/notes.txt", b"hello", "text/plain")
    assert r.status_code == 201 and r.json()["filename"] == "notes.txt"
    r = client.get(f"/support/attachments/{r.json()['id']}")
    assert r.headers["content-disposition"].startswith("attachment")


def test_attachment_other_workspace_and_internal_notes(client, engine):
    login(client, engine, "u1")
    att = upload(client).json()
    t = client.post("/support/tickets", json={**TICKET, "attachment_ids": [att["id"]]}).json()

    login(client, engine, "u2", company="Other Co")
    assert client.get(f"/support/attachments/{att['id']}").status_code == 404
    mine = upload(client).json()
    # Someone else's upload can't be attached to your message either.
    login(client, engine, "u1")
    r = client.post(f"/support/tickets/{t['id']}/messages", json={"body": "with theirs", "attachment_ids": [mine["id"]]})
    assert r.status_code == 400

    login(client, engine, "staff")
    assert client.get(f"/support/attachments/{att['id']}").status_code == 200
    note = upload(client, "trace.txt", b"stack trace", "text/plain").json()
    r = client.post(
        f"/support/admin/tickets/{t['id']}/messages", json={"body": "internal trace", "internal": True, "attachment_ids": [note["id"]]}
    )
    assert r.status_code == 200 and r.json()["messages"][-1]["attachments"][0]["id"] == note["id"]

    login(client, engine, "u1")
    assert client.get(f"/support/attachments/{note['id']}").status_code == 404
    assert all(m["attachments"] == [] or m["attachments"][0]["id"] == att["id"] for m in client.get(f"/support/tickets/{t['id']}").json()["messages"])


def test_unsent_uploads_are_pruned(client, engine):
    from datetime import datetime, timedelta, timezone

    from sqlalchemy.orm import Session

    from app.models import TicketAttachment
    from app.routers.support import prune_attachments

    login(client, engine, "u1")
    sent = upload(client).json()
    client.post("/support/tickets", json={**TICKET, "attachment_ids": [sent["id"]]})
    stale = upload(client).json()
    with Session(engine) as db:
        assert prune_attachments(db, datetime.now(timezone.utc) + timedelta(hours=25)) == 1
        assert db.get(TicketAttachment, stale["id"]) is None
        assert db.get(TicketAttachment, sent["id"]) is not None
    assert client.get(f"/support/attachments/{sent['id']}").status_code == 200


def test_ticket_detail_links_published_article(client, engine):
    t = make_ticket(client, engine)
    assert client.get(f"/support/tickets/{t['id']}").json()["kb_article"] is None
    login(client, engine, "staff")
    a = client.post(f"/support/admin/tickets/{t['id']}/to-article").json()
    login(client, engine, "u1")
    assert client.get(f"/support/tickets/{t['id']}").json()["kb_article"] is None  # still a draft
    login(client, engine, "staff")
    client.put(f"/kb/admin/articles/{a['id']}", json={"title": a["title"], "summary": a["summary"], "body": a["body"], "tags": a["tags"], "status": "published"})
    login(client, engine, "u1")
    assert client.get(f"/support/tickets/{t['id']}").json()["kb_article"]["slug"] == a["slug"]
