from tests.conftest import add_user

VALID = {"job_role": "Finance lead — owns monthly reporting", "phone": "+91 98765 43210", "timezone": "Asia/Kolkata",
         "work_start": "09:30", "work_end": "18:00", "dashboard_visibility": "anyone"}


def signed_in(client, engine, **kw):
    client.cookies.set("better-auth.session_token", add_user(engine, **kw))
    client.get("/me")  # creates the workspace


def test_profile_requires_session(client):
    assert client.get("/me/profile").status_code == 401
    assert client.put("/me/profile", json=VALID).status_code == 401


def test_empty_profile_then_save(client, engine):
    signed_in(client, engine)
    assert client.get("/me/profile").json()["job_role"] == ""
    saved = client.put("/me/profile", json=VALID)
    assert saved.status_code == 200, saved.text
    body = client.get("/me/profile").json()
    assert body["job_role"] == VALID["job_role"]
    assert body["dashboard_visibility"] == "anyone"
    assert client.get("/me").json()["job_role"] == VALID["job_role"]


def test_role_is_required(client, engine):
    signed_in(client, engine)
    for bad in ({"job_role": ""}, {"job_role": "   "}, {}):
        assert client.put("/me/profile", json={**VALID, **bad} if bad else {k: v for k, v in VALID.items() if k != "job_role"}).status_code == 422


def test_rejects_bad_times_and_visibility(client, engine):
    signed_in(client, engine)
    assert client.put("/me/profile", json={**VALID, "work_start": "25:00"}).status_code == 422
    assert client.put("/me/profile", json={**VALID, "dashboard_visibility": "world"}).status_code == 422
    assert client.put("/me/profile", json={**VALID, "signature": "javascript:alert(1)"}).status_code == 422


def test_members_and_activity_scoped_to_workspace(client, engine):
    signed_in(client, engine)
    client.put("/me/profile", json=VALID)
    add_user(engine, uid="u2", company="Other Co", name="Ravi", token="tok-2")
    members = client.get("/workspace/members").json()
    assert [m["name"] for m in members] == ["Asha Rao"]
    assert members[0]["job_role"] == VALID["job_role"]
    kinds = {a["kind"] for a in client.get("/workspace/activity").json()}
    assert kinds == {"member", "profile"}


def test_feedback(client, engine):
    signed_in(client, engine)
    assert client.post("/feedback", json={"rating": 5, "comment": "Great"}).status_code == 201
    assert client.post("/feedback", json={"rating": 6}).status_code == 422


def test_timestamps_are_utc_aware(client, engine):
    signed_in(client, engine)
    client.put("/me/profile", json=VALID)
    assert client.get("/me/profile").json()["updated_at"].endswith("Z")
    assert all(a["at"].endswith("Z") for a in client.get("/workspace/activity").json())
