"""Rate limits: per user, per window, 429 with Retry-After; fail open; Redis counting."""

import pytest
from fastapi import HTTPException

from app import rate_limit
from app.config import get_settings
from app.rate_limit import Limit
from tests.test_query import sign_in, upload

SQL = {"sql": "SELECT 1 AS one"}


@pytest.fixture
def tight(monkeypatch):
    """SQL limited to 3 per minute for these tests."""
    monkeypatch.setitem(rate_limit.LIMITS, "sql", Limit(3, 60, "SQL queries"))


def test_over_the_limit_gets_429_with_retry_after(client, engine, tight):
    sign_in(client, engine)
    for _ in range(3):
        assert client.post("/sql/run", json=SQL).status_code == 200
    r = client.post("/sql/run", json=SQL)
    assert r.status_code == 429
    assert "Too many SQL queries" in r.json()["detail"]
    assert 1 <= int(r.headers["Retry-After"]) <= 60
    # explain shares the SQL budget
    assert client.post("/sql/explain", json=SQL).status_code == 429


def test_each_user_has_their_own_budget(client, engine, tight):
    sign_in(client, engine)
    for _ in range(3):
        client.post("/sql/run", json=SQL)
    assert client.post("/sql/run", json=SQL).status_code == 429
    sign_in(client, engine, uid="u2", token="tok-2", company="Other Co")
    assert client.post("/sql/run", json=SQL).status_code == 200


def test_the_window_resets():
    rate_limit.LIMITS["_t"] = Limit(2, 60, "things")
    try:
        rate_limit.check("_t", "me", now=120.0)
        rate_limit.check("_t", "me", now=150.0)
        with pytest.raises(HTTPException) as e:
            rate_limit.check("_t", "me", now=179.0)
        assert e.value.status_code == 429 and e.value.headers["Retry-After"] == "1"
        rate_limit.check("_t", "me", now=180.0)  # next minute
    finally:
        del rate_limit.LIMITS["_t"]


def test_public_dashboards_are_limited_per_share_link(client, engine, monkeypatch):
    monkeypatch.setitem(rate_limit.LIMITS, "public", Limit(2, 60, "requests to this shared dashboard"))
    for _ in range(2):
        assert client.get("/public/dashboards/abc").status_code == 404  # unknown link, but counted
    assert client.get("/public/dashboards/abc").status_code == 429
    assert client.get("/public/dashboards/other").status_code == 404  # a different link has its own budget


def test_uploads_are_limited_per_hour(client, engine, monkeypatch):
    monkeypatch.setitem(rate_limit.LIMITS, "upload", Limit(1, 3600, "uploads"))
    sign_in(client, engine)
    upload(client)
    r = client.post("/datasets", files={"file": ("again.csv", b"a,b\n1,2\n", "text/csv")})
    assert r.status_code == 429 and "minutes" in r.json()["detail"]


def test_can_be_turned_off(client, engine, tight, monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_limits_enabled", False)
    sign_in(client, engine)
    assert all(client.post("/sql/run", json=SQL).status_code == 200 for _ in range(5))


def test_a_broken_store_lets_requests_through(client, engine, tight, monkeypatch):
    class Broken:
        def incr(self, key, ttl):
            raise ConnectionError("redis down")

    monkeypatch.setattr(rate_limit, "_store", lambda: Broken())
    sign_in(client, engine)
    assert all(client.post("/sql/run", json=SQL).status_code == 200 for _ in range(5))


def test_redis_store_counts_with_expiry():
    calls = []

    class Pipe:
        def incr(self, key):
            calls.append(("incr", key))

        def expire(self, key, ttl, nx):
            calls.append(("expire", key, ttl, nx))

        def execute(self):
            return [7, True]

    store = rate_limit._Redis.__new__(rate_limit._Redis)
    store._client = type("C", (), {"pipeline": lambda self: Pipe()})()
    assert store.incr("rl:sql:user:1:5", 60) == 7
    assert calls == [("incr", "rl:sql:user:1:5"), ("expire", "rl:sql:user:1:5", 60, True)]
