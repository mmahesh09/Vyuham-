"""PDF reports go to the Forme renderer first and fall back to Chromium when it can't be used."""

import io
import json
import urllib.error

import pytest

from app.config import get_settings
from app.query import QueryError
from app.reports import pdf


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "pdf_renderer", "forme")
    monkeypatch.setattr(s, "pdf_chromium_fallback", True)
    monkeypatch.setattr(s, "print_base_url", "http://web.test/")
    return s


@pytest.fixture
def chromium(monkeypatch):
    calls = []
    monkeypatch.setattr(pdf, "render_chromium", lambda token, out, **kw: (calls.append(token), open(out, "wb").write(b"%PDF-chromium")))
    return calls


def _http_error(code, body):
    return urllib.error.HTTPError("http://web.test/internal/pdf", code, "x", {}, io.BytesIO(json.dumps(body).encode()))


def test_forme_success_writes_the_pdf(settings, chromium, monkeypatch, tmp_path):
    sent = {}

    def fake_urlopen(req, timeout):
        sent.update(url=req.full_url, body=json.loads(req.data), timeout=timeout)
        return _Resp(b"%PDF-1.7 forme")

    monkeypatch.setattr(pdf.urllib.request, "urlopen", fake_urlopen)
    out = tmp_path / "r.pdf"
    pdf.render_dashboard_pdf("tok/1", str(out), landscape=True, page_size="Letter")
    assert out.read_bytes() == b"%PDF-1.7 forme"
    assert sent["url"] == "http://web.test/internal/pdf"
    assert sent["body"] == {"token": "tok/1", "page_size": "Letter", "landscape": True}
    assert chromium == []


@pytest.mark.parametrize(
    "failure",
    [urllib.error.URLError("connection refused"), _http_error(502, {"error": "API down"}), TimeoutError("slow"), "not-a-pdf"],
)
def test_unusable_forme_falls_back_to_chromium(settings, chromium, monkeypatch, tmp_path, failure):
    def fake_urlopen(req, timeout):
        if failure == "not-a-pdf":
            return _Resp(b"<html>oops</html>")
        raise failure

    monkeypatch.setattr(pdf.urllib.request, "urlopen", fake_urlopen)
    out = tmp_path / "r.pdf"
    pdf.render_dashboard_pdf("tok", str(out))
    assert out.read_bytes() == b"%PDF-chromium" and chromium == ["tok"]


def test_expired_token_fails_without_fallback(settings, chromium, monkeypatch, tmp_path):
    monkeypatch.setattr(pdf.urllib.request, "urlopen", lambda req, timeout: (_ for _ in ()).throw(_http_error(404, {"error": "This print link has expired."})))
    with pytest.raises(QueryError, match="expired"):
        pdf.render_dashboard_pdf("tok", str(tmp_path / "r.pdf"))
    assert chromium == []


def test_no_fallback_raises_a_retryable_error(settings, chromium, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "pdf_chromium_fallback", False)
    monkeypatch.setattr(pdf.urllib.request, "urlopen", lambda req, timeout: (_ for _ in ()).throw(urllib.error.URLError("down")))
    with pytest.raises(pdf.RenderError):
        pdf.render_dashboard_pdf("tok", str(tmp_path / "r.pdf"))
    assert chromium == []


def test_chromium_setting_skips_forme(settings, chromium, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "pdf_renderer", "chromium")
    monkeypatch.setattr(pdf.urllib.request, "urlopen", lambda *a, **k: pytest.fail("Forme called"))
    pdf.render_dashboard_pdf("tok", str(tmp_path / "r.pdf"))
    assert chromium == ["tok"]
