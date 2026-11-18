"""Connections to customers' PostgreSQL and MySQL databases.

Safety rules, in order:
- The host must resolve to a public address (unless CONNECTIONS_ALLOW_PRIVATE), so a connection can't
  be pointed at our own Postgres, Redis or cloud metadata. Postgres connects to the resolved address
  (libpq `hostaddr`), so DNS can't swap in a private address between the check and the connect.
- Every session is read-only with a statement timeout (see `session`), on top of the advice to use a
  read-only database user.
- Errors are turned into short messages a customer can act on; driver messages never include the password.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from sqlalchemy import Connection as SAConnection
from sqlalchemy import create_engine, event
from sqlalchemy.engine import URL, Engine
from sqlalchemy.exc import DBAPIError, SQLAlchemyError
from sqlalchemy.pool import NullPool

from app.config import get_settings

KINDS = ("postgres", "mysql")
SSL_MODES = ("require", "verify-full", "disable")
DEFAULT_PORT = {"postgres": 5432, "mysql": 3306}
CONNECT_TIMEOUT = 10
STATEMENT_TIMEOUT_MS = 60_000


class ConnectorError(ValueError):
    """A problem with a connection the customer can fix; the message is shown as-is."""


@dataclass(frozen=True)
class ConnSpec:
    kind: str
    host: str
    port: int
    database: str
    username: str
    password: str
    ssl_mode: str = "require"

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise ConnectorError("Choose PostgreSQL or MySQL.")
        if self.ssl_mode not in SSL_MODES:
            raise ConnectorError("SSL must be require, verify-full or disable.")
        if not (0 < self.port < 65536):
            raise ConnectorError("The port must be between 1 and 65535.")


def spec_for(conn, password: str | None = None) -> ConnSpec:
    """ConnSpec for a saved Connection; decrypts the stored password unless one is given."""
    from app.crypto import decrypt

    return ConnSpec(
        kind=conn.kind, host=conn.host, port=conn.port, database=conn.database, username=conn.username,
        password=password if password is not None else decrypt(conn.secret_enc), ssl_mode=conn.ssl_mode,
    )


def _blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
        or ip.is_reserved or ip.is_unspecified or not ip.is_global
    )


def resolve_public(host: str) -> str:
    """The address to connect to, after checking every address the host resolves to is public."""
    host = host.strip()
    if not host or len(host) > 253 or any(c in host for c in " /\\@?#"):
        raise ConnectorError("Enter just the host name, for example db.example.com.")
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise ConnectorError(f"We couldn't find the host “{host}”. Check the spelling.") from e
    addrs = list(dict.fromkeys(info[4][0] for info in infos))
    if not addrs:
        raise ConnectorError(f"We couldn't find the host “{host}”. Check the spelling.")
    if not get_settings().connections_allow_private:
        for a in addrs:
            if _blocked(ipaddress.ip_address(a.split("%")[0])):
                raise ConnectorError(
                    "That host is on a private network. Use the database's public address, and allowlist our IP in its firewall."
                )
    return addrs[0]


def _ca_file() -> str | None:
    try:
        import certifi

        return certifi.where()
    except ImportError:  # fall back to the system store
        return None


def engine_for(spec: ConnSpec) -> Engine:
    """A single-use engine (no pool) for one sync, test or listing."""
    addr = resolve_public(spec.host)
    if spec.kind == "postgres":
        url = URL.create(
            "postgresql+psycopg", username=spec.username, password=spec.password,
            host=spec.host, port=spec.port, database=spec.database,
        )
        args: dict = {"connect_timeout": CONNECT_TIMEOUT, "hostaddr": addr, "sslmode": spec.ssl_mode,
                      "application_name": "vyuham-sync"}
        if spec.ssl_mode == "verify-full" and (ca := _ca_file()):
            args["sslrootcert"] = ca
        return create_engine(url, poolclass=NullPool, connect_args=args)

    # MySQL: connect to the checked address; with verify-full the name is needed for the certificate check.
    url = URL.create(
        "mysql+pymysql", username=spec.username, password=spec.password,
        host=spec.host if spec.ssl_mode == "verify-full" else addr, port=spec.port, database=spec.database,
        query={"charset": "utf8mb4"},
    )
    args = {"connect_timeout": CONNECT_TIMEOUT, "read_timeout": STATEMENT_TIMEOUT_MS // 1000 + 30}
    if spec.ssl_mode == "require":
        args["ssl"] = {"check_hostname": False}  # encrypted; certificate not verified (like libpq "require")
    elif spec.ssl_mode == "verify-full":
        args["ssl"] = {"ca": _ca_file(), "check_hostname": True}
    engine = create_engine(url, poolclass=NullPool, connect_args=args)

    @event.listens_for(engine, "connect")
    def _read_only(dbapi_conn, _record):  # before any transaction starts
        cur = dbapi_conn.cursor()
        cur.execute("SET SESSION TRANSACTION READ ONLY")
        try:
            cur.execute(f"SET SESSION max_execution_time = {STATEMENT_TIMEOUT_MS}")  # MySQL 5.7.8+
        except Exception:
            cur.execute(f"SET SESSION max_statement_time = {STATEMENT_TIMEOUT_MS // 1000}")  # MariaDB, in seconds
        cur.close()

    return engine


@contextmanager
def session(spec: ConnSpec) -> Iterator[SAConnection]:
    """A read-only transaction on the customer's database, closed (and rolled back) afterwards."""
    engine = engine_for(spec)
    try:
        with engine.connect() as conn:
            with conn.begin() as tx:
                if spec.kind == "postgres":
                    # First statements of the transaction; works through PgBouncer in transaction mode too.
                    conn.exec_driver_sql("SET TRANSACTION READ ONLY")
                    conn.exec_driver_sql(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}")
                yield conn
                tx.rollback()  # nothing to keep: read-only
    except ConnectorError:
        raise
    except SQLAlchemyError as e:
        raise ConnectorError(friendly_error(e, spec)) from e
    finally:
        engine.dispose()


def friendly_error(e: Exception, spec: ConnSpec) -> str:
    raw = str(e.orig if isinstance(e, DBAPIError) and e.orig is not None else e)
    msg = raw.lower()
    where = f"{spec.host}:{spec.port}"
    if spec.password and spec.password in raw:  # belt and braces: never echo the password
        raw = raw.replace(spec.password, "••••")
    if "password authentication failed" in msg or "access denied" in msg:
        return "The username or password was rejected."
    if "does not exist" in msg and "database" in msg or "unknown database" in msg:
        return f"There's no database called “{spec.database}” on this server."
    if "timeout" in msg or "timed out" in msg:
        return f"Couldn't reach {where} in time. Check the host and port, and allowlist our IP in the database's firewall."
    if "connection refused" in msg or "can't connect" in msg or "could not connect" in msg:
        return f"{where} refused the connection. Check the host and port, and that the database accepts outside connections."
    if "ssl" in msg or "certificate" in msg:
        return "The SSL connection failed. Try SSL mode “require”, or check the server's certificate."
    if "read-only" in msg or "read only" in msg:
        return "Vyuham only reads data, so this statement isn't allowed."
    if "statement timeout" in msg or "max_execution_time" in msg or "canceling statement" in msg:
        return "The query took longer than 60 seconds. Pick fewer columns or add a filter."
    if "permission denied" in msg or "command denied" in msg:
        return "This user isn't allowed to read that table. Grant it SELECT, or use a different user."
    return raw.strip().splitlines()[0][:300] if raw.strip() else "The database returned an error."
