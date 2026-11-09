"""PDF of a dashboard: headless Chromium opens the app's print page and prints it.

The print page (frontend/src/app/print/dashboards/[token]) uses the same chart components as the
app, so the PDF matches what people see on screen. It sets `window.__vyuhamReady = true` once the
data has loaded and every chart has drawn, or `window.__vyuhamError` with a message.

Needs Chromium for Playwright: `playwright install --with-deps chromium` (the worker image does
this; locally, `.venv/Scripts/playwright install chromium`).
"""

from __future__ import annotations

from urllib.parse import quote

from app.config import get_settings
from app.query import QueryError

READY = "() => window.__vyuhamReady === true || typeof window.__vyuhamError === 'string'"


class RenderError(RuntimeError):
    """The browser or page failed in a way worth retrying (crash, timeout)."""


def print_url(token: str) -> str:
    return f"{get_settings().print_base_url.rstrip('/')}/print/dashboards/{quote(token, safe='')}"


def render_dashboard_pdf(token: str, out_path: str, *, landscape: bool = False, page_size: str = "A4", timeout_ms: int = 90_000) -> None:
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
