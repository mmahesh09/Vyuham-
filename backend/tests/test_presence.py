from datetime import date, timedelta

from tests.conftest import add_user

TODAY = date.today()


def signed_in(client, engine, **kw):
    client.cookies.set("better-auth.session_token", add_user(engine, **kw))
    client.get("/me")


def leave(**kw):
    return {"leave_type": "sick", "start_date": str(TODAY), "end_date": str(TODAY + timedelta(days=2)),
            "backup_name": "Priya (agency)", **kw}


def test_default_is_available(client, engine):
    signed_in(client, engine)
    assert client.get("/me/presence").json()["status"] == "available"


def test_simple_statuses(client, engine):
    signed_in(client, engine)
    for s in ("away", "busy", "dnd", "appear_offline", "out_of_office", "available"):
        r = client.put("/me/presence", json={"status": s, "message": "hi"})
        assert r.status_code == 200 and r.json()["status"] == s
    assert client.put("/me/presence", json={"status": "sleeping"}).status_code == 422


def test_leave_needs_details_and_backup(client, engine):
    signed_in(client, engine)
    assert client.put("/me/presence", json={"status": "on_leave"}).status_code == 422
    assert client.put("/me/presence", json={"status": "on_leave", "leave": leave(backup_name=None)}).status_code == 422
    bad_dates = leave(end_date=str(TODAY - timedelta(days=1)))
    assert client.put("/me/presence", json={"status": "on_leave", "leave": bad_dates}).status_code == 422
    assert client.put("/me/presence", json={"status": "on_leave", "leave": leave(leave_type="vacation")}).status_code == 422


def test_leave_history_and_backup_shown_to_team(client, engine):
    signed_in(client, engine)
    r = client.put("/me/presence", json={"status": "on_leave", "leave": leave()})
    assert r.status_code == 200
    assert r.json()["leave"]["backup_name"] == "Priya (agency)"
    # switch to paid leave: the sick one stays in history
    client.put("/me/presence", json={"status": "on_leave", "leave": leave(leave_type="paid")})
    history = client.get("/me/leaves").json()
    assert sorted(l["leave_type"] for l in history) == ["paid", "sick"]
    assert {l["status"] for l in history} == {"active", "ended"}
    me = client.get("/workspace/members").json()[0]
    assert (me["status"], me["leave_type"], me["backup_name"]) == ("on_leave", "paid", "Priya (agency)")
    assert any(a["kind"] == "leave" for a in client.get("/workspace/activity").json())
    # changing only the message keeps the same leave (no duplicate history)
    client.put("/me/presence", json={"status": "on_leave", "message": "Back Monday"})
    assert len(client.get("/me/leaves").json()) == 2
    assert client.get("/me/presence").json()["leave"]["leave_type"] == "paid"
    # back to work ends the leave
    client.put("/me/presence", json={"status": "available"})
    assert all(l["status"] != "active" for l in client.get("/me/leaves").json())


def test_backup_must_be_teammate(client, engine):
    signed_in(client, engine)
    add_user(engine, uid="u2", company="Other", name="Ravi", token="tok-2")
    r = client.put("/me/presence", json={"status": "on_leave", "leave": leave(backup_user_id="u2", backup_name=None)})
    assert r.status_code == 422
    r = client.put("/me/presence", json={"status": "on_leave", "leave": leave(backup_user_id="u1", backup_name=None)})
    assert r.status_code == 422


def test_expired_leave_returns_to_available(client, engine):
    signed_in(client, engine)
    past = leave(start_date=str(TODAY - timedelta(days=5)), end_date=str(TODAY - timedelta(days=1)))
    client.put("/me/presence", json={"status": "on_leave", "leave": past})
    assert client.get("/me/presence").json()["status"] == "available"
    assert client.get("/me/leaves").json()[0]["status"] == "ended"
