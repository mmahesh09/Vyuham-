"""PDF of a dashboard.

Two renderers, picked by PDF_RENDERER:

- "forme" (default): the web app renders the PDF itself with Forme (frontend/src/app/internal/pdf).
  The worker POSTs the signed print token to PRINT_BASE_URL/internal/pdf and gets PDF bytes back.
  No browser: about 6x faster and 2.4x less memory than Chromium in our measurements.
- "chromium": headless Chromium opens the app's print page (frontend/src/app/print/dashboards/[token])
  and prints it. The page sets `window.__vyuhamReady = true` once every chart has drawn, or
  `window.__vyuhamError` with a message.

With PDF_CHROMIUM_FALLBACK on (the default), a Forme renderer that can't be reached, crashes or
returns something that isn't a PDF falls back to Chromium for that report. An expired or unknown
print token fails the report either way: it's not something a retry fixes.

Chromium needs Playwright's browser: `playwright install --with-deps chromium` (the worker image does
this; locally, `.venv/Scripts/playwright install chromium`).
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from urllib.parse import quote

from app.config import get_settings
from app.query import QueryError

log = logging.getLogger("app.reports.pdf")
READY = "() => window.__vyuhamReady === true || typeof window.__vyuhamError === 'string'"


class RenderError(RuntimeError):
    """The renderer failed in a way worth retrying (crash, timeout)."""


class RendererUnavailable(RuntimeError):
    """The Forme renderer couldn't be used for this report (unreachable, 5xx, bad output)."""


def print_url(token: str) -> str:
    return f"{get_settings().print_base_url.rstrip('/')}/print/dashboards/{quote(token, safe='')}"


def forme_url() -> str:
    return f"{get_settings().print_base_url.rstrip('/')}/internal/pdf"


def _error_text(e: urllib.error.HTTPError) -> str:
    try:
        body = json.loads(e.read() or b"{}")
        return str(body.get("error") or body.get("detail") or e.reason)[:300]
    except Exception:
        return str(e.reason)[:300]


def render_forme(token: str, out_path: str, *, landscape: bool = False, page_size: str = "A4", timeout_s: float = 90) -> None:
    payload = json.dumps({"token": token, "page_size": page_size, "landscape": landscape}).encode()
    req = urllib.request.Request(forme_url(), data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as res:  # noqa: S310 (server-configured URL)
            data = res.read()
    except urllib.error.HTTPError as e:
        detail = _error_text(e)
        if e.code in (400, 404, 422):  # the request itself is wrong (expired token, deleted dashboard)
            raise QueryError(detail) from e
        raise RendererUnavailable(f"PDF renderer answered {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise RendererUnavailable(f"PDF renderer unreachable at {forme_url()}: {e}") from e
    if not data.startswith(b"%PDF"):
        raise RendererUnavailable("PDF renderer returned something that isn't a PDF")
    with open(out_path, "wb") as f:
        f.write(data)


def render_chromium(token: str, out_path: str, *, landscape: bool = False, page_size: str = "A4", timeout_ms: int = 90_000) -> None:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--disable-dev-shm-usage"])
            try:
                page = browser.new_page(viewport={"width": 1240 if landscape else 1000, "height": 1400}, device_scale_factor=2)
                page.goto(print_url(token), wait_until="domcontentloaded", timeout=timeout_ms)
                page.wait_for_function(READY, timeout=timeout_ms)
                error = page.evaluate("() => window.__vyuhamError || null")
                if error:
                    raise QueryError(str(error)[:300])
                page.pdf(
                    path=out_path,
                    format=page_size,
                    landscape=landscape,
                    print_background=True,
                    margin={"top": "14mm", "bottom": "14mm", "left": "12mm", "right": "12mm"},
                )
            finally:
                browser.close()
    except PlaywrightError as e:
        raise RenderError(f"Couldn't render the PDF: {str(e).splitlines()[0][:200]}") from e


def render_dashboard_pdf(token: str, out_path: str, *, landscape: bool = False, page_size: str = "A4", timeout_ms: int = 90_000) -> None:
    s = get_settings()
    if s.pdf_renderer == "forme":
        try:
            render_forme(token, out_path, landscape=landscape, page_size=page_size, timeout_s=timeout_ms / 1000)
            return
        except RendererUnavailable as e:
            if not s.pdf_chromium_fallback:
                raise RenderError(str(e)) from e
            log.warning("Forme PDF renderer unavailable (%s); using Chromium for this report", e)
    render_chromium(token, out_path, landscape=landscape, page_size=page_size, timeout_ms=timeout_ms)
