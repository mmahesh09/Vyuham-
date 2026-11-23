"""Import a dataset from a public link (a CSV/JSON/XLSX/Parquet file or a Google Sheets link).

The server fetches the link itself, so it must never be usable to reach private networks:
- only http/https, standard ports;
- every address the host resolves to must be public (same rule as database connections);
- the connection goes to the address that was checked (no second DNS lookup to rebind);
- redirects are followed by hand (at most 3), each one checked the same way;
- the body is capped at the upload size limit, with a timeout.
"""

from __future__ import annotations

import ipaddress
import re
from urllib.parse import urljoin, urlsplit

import urllib3

from app.config import get_settings
from app.connectors.base import ConnectorError, resolve_public

MAX_REDIRECTS = 3
TIMEOUT = urllib3.Timeout(connect=10, read=30)
EXT_BY_TYPE = {
    "text/csv": ".csv",
    "application/csv": ".csv",
    "text/plain": ".csv",
    "application/json": ".json",
    "application/x-ndjson": ".json",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.apache.parquet": ".parquet",
    "application/x-parquet": ".parquet",
}
SHEETS = re.compile(r"^https://docs\.google\.com/spreadsheets/d/([\w-]+)")


class UrlError(ValueError):
    """The link can't be imported; shown to the person as-is."""


def normalise(url: str) -> str:
    """A Google Sheets page link becomes its CSV export link (the tab in #gid= is kept)."""
    url = url.strip()
    m = SHEETS.match(url)
    if m and "/export" not in url:
        gid = re.search(r"[#&?]gid=(\d+)", url)
        return f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=csv" + (f"&gid={gid.group(1)}" if gid else "")
    return url


def _ca_certs() -> str | None:
    try:
        import certifi

        return certifi.where()
    except ImportError:
        return None


def _get(url: str, limit: int) -> tuple[bytes, str, str]:
    """(body, content type, final url). Raises UrlError."""
    for _ in range(MAX_REDIRECTS + 1):
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise UrlError("Use an http:// or https:// link.")
        if parts.username or parts.password:
            raise UrlError("Links with a username or password in them aren't supported.")
        port = parts.port or (443 if parts.scheme == "https" else 80)
        if port not in (80, 443, 8080, 8443):
            raise UrlError("Only links on the standard web ports work.")
        try:
            ip = resolve_public(parts.hostname)
        except ConnectorError as e:
            raise UrlError(str(e).replace("database's", "file's").replace(" and allowlist our IP in its firewall", "")) from e
        host_header = parts.hostname if parts.port is None else f"{parts.hostname}:{parts.port}"
        path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        if parts.scheme == "https":
            pool: urllib3.HTTPConnectionPool = urllib3.HTTPSConnectionPool(
                ip, port, server_hostname=parts.hostname, assert_hostname=parts.hostname,
                cert_reqs="CERT_REQUIRED", ca_certs=_ca_certs(), timeout=TIMEOUT, retries=False,
            )
        else:
            # The person pasted a plain http:// link; https:// links take the verified-TLS branch above.
            pool = urllib3.HTTPConnectionPool(ip, port, timeout=TIMEOUT, retries=False)  # nosemgrep: python.lang.security.audit.network.http-not-https-connection.http-not-https-connection
        try:
            resp = pool.urlopen(
                "GET", path, headers={"Host": host_header, "User-Agent": "Vyuham-import/1.0", "Accept": "*/*"},
                redirect=False, preload_content=False,
            )
        except urllib3.exceptions.HTTPError as e:
            raise UrlError("We couldn't download that link. Check it opens in a private browser window.") from e
        try:
            if resp.status in (301, 302, 303, 307, 308):
                loc = resp.headers.get("Location")
                if not loc:
                    raise UrlError("That link redirects nowhere.")
                url = urljoin(url, loc)
                continue
            if resp.status in (401, 403):
                raise UrlError("That link needs a sign-in. Share the file publicly (anyone with the link) and try again.")
            if resp.status != 200:
                raise UrlError(f"The link answered with an error ({resp.status}).")
            chunks, size = [], 0
            for chunk in resp.stream(1024 * 256):
                size += len(chunk)
                if size > limit:
                    raise UrlError(f"That file is over {limit // (1024 * 1024)} MB, the beta limit.")
                chunks.append(chunk)
            return b"".join(chunks), (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower(), url
        finally:
            resp.release_conn()
    raise UrlError("That link redirects too many times.")


def filename_for(url: str, content_type: str) -> str:
    path = urlsplit(url).path
    name = path.rsplit("/", 1)[-1] or "import"
    lower = name.lower()
    for ext in (".csv", ".json", ".xlsx", ".parquet", ".jsonl", ".ndjson"):
        if lower.endswith(ext):
            return name if ext not in (".jsonl", ".ndjson") else name.rsplit(".", 1)[0] + ".json"
    if SHEETS.match(url) or "format=csv" in url:
        return "Google Sheet.csv"
    ext = EXT_BY_TYPE.get(content_type)
    if not ext:
        raise UrlError("That link isn't a CSV, JSON, Excel or Parquet file.")
    return f"{name}{ext}"


def fetch(url: str) -> tuple[bytes, str, str]:
    """(file bytes, a filename with the right extension, the normalised link)."""
    url = normalise(url)
    if len(url) > 2000:
        raise UrlError("That link is too long.")
    try:
        ipaddress.ip_address(urlsplit(url).hostname or "")
        literal_ip = True
    except ValueError:
        literal_ip = False
    if literal_ip and get_settings().environment == "production":
        raise UrlError("Use the file's web address, not an IP address.")
    raw, ctype, final = _get(url, get_settings().max_upload_bytes)
    if not raw:
        raise UrlError("That link returned an empty file.")
    if ctype == "text/html" or raw[:15].lower().lstrip().startswith((b"<!doctype html", b"<html")):
        raise UrlError("That link opens a web page, not a file. Use the file's download link.")
    return raw, filename_for(final, ctype), url
