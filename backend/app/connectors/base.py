"""Connections to customers' PostgreSQL and MySQL databases.

Safety rules, in order:
- The host must resolve to a public address (unless CONNECTIONS_ALLOW_PRIVATE), so a connection can't
  be pointed at our own Postgres, Redis or cloud metadata. Both drivers connect to the address that was
  checked, so DNS can't swap in a private address between the check and the connect.
- With SSL on, the password is only sent over TLS. A server that doesn't offer TLS is refused.
- Every session is read-only with a statement timeout (see `session`), on top of the advice to use a
  read-only database user.
- Errors are turned into short messages a customer can act on; they never include the password.
"""

from __future__ import annotations

import ipaddress
import logging
import re
import socket
import ssl
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field

import pymysql
from pymysql.constants import CLIENT
from sqlalchemy import Connection as SAConnection
from sqlalchemy import create_engine, event
from sqlalchemy.engine import URL, Engine
from sqlalchemy.exc import DBAPIError, SQLAlchemyError
from sqlalchemy.pool import NullPool

from app.config import get_settings

log = logging.getLogger("app.connectors")

KINDS = ("postgres", "mysql")
SSL_MODES = ("require", "verify-full", "disable")
DEFAULT_PORT = {"postgres": 5432, "mysql": 3306}
CONNECT_TIMEOUT = 10
STATEMENT_TIMEOUT_MS = 60_000
MYSQL_SYSTEM_DATABASES = {"information_schema", "mysql", "performance_schema", "sys"}


class ConnectorError(ValueError):
    """A problem with a connection the customer can fix; the message is shown as-is."""


class QueryProblem(ConnectorError):
    """The database is reachable, but this table or query can't be read. The connection itself is fine."""


def _has_control_chars(value: str) -> bool:
    return any(ord(c) < 32 or ord(c) == 127 for c in value)


@dataclass(frozen=True)
class ConnSpec:
    kind: str
    host: str
    port: int
    database: str
    username: str
    password: str = field(repr=False)  # kept out of logs, tracebacks and error reports
    ssl_mode: str = "require"

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise ConnectorError("Choose PostgreSQL or MySQL.")
        if self.ssl_mode not in SSL_MODES:
            raise ConnectorError("SSL must be require, verify-full or disable.")
        if not (0 < self.port < 65536):
            raise ConnectorError("The port must be between 1 and 65535.")
        if any(_has_control_chars(v) for v in (self.host, self.database, self.username)) or "\x00" in self.password:
            raise ConnectorError("The connection details contain characters that aren't allowed.")
        if self.kind == "mysql" and self.database.lower() in MYSQL_SYSTEM_DATABASES:
            raise ConnectorError("Connect to the database that holds your data, not a MySQL system database.")


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
    if not host or len(host) > 253 or any(c in host for c in " /\\@?#") or _has_control_chars(host):
        raise ConnectorError("Enter just the host name, for example db.example.com.")
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except UnicodeError as e:  # a label the resolver can't encode: empty, or over 63 characters
        raise ConnectorError("Enter just the host name, for example db.example.com.") from e
    except OSError as e:
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
    # IPv4 first: many servers and containers have no working IPv6 route.
    return sorted(addrs, key=lambda a: ":" in a)[0]


def _ca_file() -> str | None:
    try:
        import certifi

        return certifi.where()
    except ImportError:  # fall back to the system store
        return None


class _MySQLConnection(pymysql.connections.Connection):
    """PyMySQL carries on without TLS if the server doesn't offer it; with SSL on, refuse before logging in."""

    def _request_authentication(self):
        if self.ssl and not self.server_capabilities & CLIENT.SSL:
            raise pymysql.err.OperationalError(2026, "server does not support SSL")
        super()._request_authentication()


def _mysql_tls(spec: ConnSpec) -> ssl.SSLContext | None:
    if spec.ssl_mode == "disable":
        return None
    if spec.ssl_mode == "verify-full":  # a CA is always loaded: certifi's, or the system store
        return ssl.create_default_context(cafile=_ca_file())
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)  # encrypted; certificate not verified (like libpq "require")
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _connect_mysql(spec: ConnSpec, addr: str) -> pymysql.connections.Connection:
    """Open the socket to the checked address; `host` stays the name, for the certificate check."""
    try:
        sock = socket.create_connection((addr, spec.port), CONNECT_TIMEOUT)
    except OSError as e:
        raise pymysql.err.OperationalError(2003, f"Can't connect to MySQL server on '{spec.host}' ({e})") from e
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    sock.settimeout(None)
    conn = _MySQLConnection(
        host=spec.host, port=spec.port, user=spec.username, password=spec.password, database=spec.database,
        charset="utf8mb4", connect_timeout=CONNECT_TIMEOUT, read_timeout=STATEMENT_TIMEOUT_MS // 1000 + 30,
        write_timeout=CONNECT_TIMEOUT * 3, ssl=_mysql_tls(spec), local_infile=False, defer_connect=True,
    )
    conn.connect(sock)  # closes the socket itself if the handshake fails
    return conn


def engine_for(spec: ConnSpec) -> Engine:
    """A single-use engine (no pool) for one sync, test or listing."""
    addr = resolve_public(spec.host)
    if spec.kind == "postgres":
        url = URL.create(
            "postgresql+psycopg", username=spec.username, password=spec.password,
            host=spec.host, port=spec.port, database=spec.database,
        )
        args: dict = {
            "connect_timeout": CONNECT_TIMEOUT, "hostaddr": addr, "sslmode": spec.ssl_mode,
            "application_name": "vyuham-sync",
            # The statement timeout needs a responsive server; these notice one that has gone silent.
            "keepalives": 1, "keepalives_idle": 30, "keepalives_interval": 10, "keepalives_count": 3,
            "tcp_user_timeout": 60_000,
        }
        if spec.ssl_mode == "verify-full" and (ca := _ca_file()):
            args["sslrootcert"] = ca
        return create_engine(url, poolclass=NullPool, connect_args=args)

    engine = create_engine("mysql+pymysql://", poolclass=NullPool, creator=lambda: _connect_mysql(spec, addr))

    @event.listens_for(engine, "connect")
    def _read_only(dbapi_conn, _record):  # before any transaction starts
        cur = dbapi_conn.cursor()
        cur.execute("SET SESSION TRANSACTION READ ONLY")
        # Queries are generated for MySQL's default quoting rules, so the session must use them too.
        cur.execute("SET SESSION sql_mode = REPLACE(REPLACE(@@SESSION.sql_mode, 'NO_BACKSLASH_ESCAPES', ''), 'ANSI_QUOTES', '')")
        try:
            cur.execute(f"SET SESSION max_execution_time = {STATEMENT_TIMEOUT_MS}")  # MySQL 5.7.8+
        except pymysql.err.MySQLError:
            cur.execute(f"SET SESSION max_statement_time = {STATEMENT_TIMEOUT_MS // 1000}")  # MariaDB, in seconds
        cur.close()

    return engine


@contextmanager
def session(spec: ConnSpec) -> Iterator[SAConnection]:
    """A read-only transaction on the customer's database, closed (and rolled back) afterwards.

    Failures become a ConnectorError. Once the session is open they are a QueryProblem, because the
    connection itself worked.
    """
    engine: Engine | None = None
    opened = False
    try:
        engine = engine_for(spec)
        with engine.connect() as conn:
            with conn.begin() as tx:
                if spec.kind == "postgres":
                    # First statements of the transaction; works through PgBouncer in transaction mode too.
                    conn.exec_driver_sql("SET TRANSACTION READ ONLY")
                    conn.exec_driver_sql(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}")
                    conn.exec_driver_sql("SET LOCAL standard_conforming_strings = on")
                else:
                    # Per transaction as well as per session: a proxy may not keep session settings.
                    conn.exec_driver_sql("START TRANSACTION READ ONLY")
                opened = True
                yield conn
                tx.rollback()  # nothing to keep: read-only
    except ConnectorError:
        raise
    except SQLAlchemyError as e:
        _log_failure(spec, e, opened)
        raise (QueryProblem if opened else ConnectorError)(friendly_error(e, spec)) from e
    except (OSError, EOFError, UnicodeError, OverflowError) as e:  # the network, or a value the driver can't decode
        _log_failure(spec, e, opened)
        raise (QueryProblem if opened else ConnectorError)(
            "The connection to the database failed while reading. Try again in a moment."
        ) from e
    finally:
        if engine is not None:
            engine.dispose()


def _codes(e: BaseException) -> tuple[BaseException | None, str | None, int | None]:
    """The driver's exception, its SQLSTATE (Postgres) and its error number (MySQL)."""
    orig = e.orig if isinstance(e, DBAPIError) else None
    sqlstate = getattr(orig, "sqlstate", None)
    args = getattr(orig, "args", ())
    return orig, sqlstate, args[0] if args and isinstance(args[0], int) else None


def _log_failure(spec: ConnSpec, e: BaseException, opened: bool) -> None:
    """Enough to diagnose a failure. Driver messages are left out: they can quote names and SQL."""
    orig, sqlstate, errno = _codes(e)
    log.warning(
        "connector failure kind=%s stage=%s error=%s sqlstate=%s errno=%s",
        spec.kind, "query" if opened else "connect", type(orig if orig is not None else e).__name__, sqlstate, errno,
    )


_SQLSTATE = {
    "28P01": "auth", "3D000": "no_database", "57014": "slow", "25006": "read_only", "42501": "denied",
    "42P01": "no_table", "42703": "no_column", "42601": "syntax", "42702": "duplicate", "53300": "busy",
    "57P01": "lost", "57P02": "lost", "57P03": "lost",
}
_MYSQL_ERRNO = {
    1045: "auth", 1044: "database_denied", 1049: "no_database", 1142: "denied", 1143: "denied", 1227: "denied",
    1370: "denied", 1146: "no_table", 1054: "no_column", 1064: "syntax", 1060: "duplicate", 3024: "slow",
    1969: "slow", 1317: "slow", 1792: "read_only", 1040: "busy", 1203: "busy", 1129: "not_allowed", 1130: "not_allowed",
    2006: "lost", 2013: "lost", 3159: "tls",
}
# Checked in order against the message with quoted names removed, so a user called "russell" isn't an SSL problem.
_TEXT_RULES = [
    (r"password authentication failed|access denied|role\s+does not exist", "auth"),
    (r"pg_hba\.conf", "not_allowed"),
    (r"does not support ssl|ssl is not enabled", "no_tls"),
    (r"\bssl\b|\btls\b|certificate", "tls"),
    (r"database\s+does not exist|unknown database", "no_database"),
    (r"statement timeout|canceling statement|maximum statement execution", "slow"),
    (r"timeout|timed out", "unreachable"),
    (r"refused|could not connect|cannot connect|no route to host|unreachable|could not translate", "refused"),
    (r"server closed|connection (was )?(lost|closed|reset)|terminating connection", "lost"),
    (r"too many (connections|clients)|remaining connection slots", "busy"),
    (r"read-only|read only", "read_only"),
    (r"permission denied|command denied", "denied"),
]


def _messages(spec: ConnSpec) -> dict[str, str]:
    where = f"{spec.host}:{spec.port}"
    return {
        "auth": "The username or password was rejected.",
        "database_denied": f"This user isn't allowed to use the database “{spec.database}”.",
        "no_database": f"There's no database called “{spec.database}” on this server.",
        "not_allowed": "This database doesn't accept connections from Vyuham. Allowlist our IP for this user, and check its SSL rules.",
        "no_tls": "This server doesn't offer SSL. Turn SSL on for the database, or set SSL to Off if you accept an unencrypted connection.",
        "tls": "The SSL connection failed. Try SSL mode “Require”, or check the server's certificate.",
        "slow": f"The query took longer than {STATEMENT_TIMEOUT_MS // 1000} seconds. Pick fewer columns or add a filter.",
        "unreachable": f"Couldn't reach {where} in time. Check the host and port, and allowlist our IP in the database's firewall.",
        "refused": f"{where} refused the connection. Check the host and port, and that the database accepts outside connections.",
        "lost": "The database closed the connection. Try again in a moment.",
        "busy": "The database has too many connections right now. Try again in a moment.",
        "read_only": "Vyuham only reads data, so this statement isn't allowed.",
        "denied": "This user isn't allowed to read that table. Grant it SELECT, or use a different user.",
        "no_table": "That table doesn't exist, or this user can't see it.",
        "no_column": "The query names a column that doesn't exist.",
        "syntax": "The database couldn't read this query. Check the SQL.",
        "duplicate": "Two columns have the same name. Give each one its own name with AS.",
    }


def friendly_error(e: Exception, spec: ConnSpec) -> str:
    orig, sqlstate, errno = _codes(e)
    raw = str(orig.args[1]) if errno is not None and len(orig.args) > 1 else str(orig if orig is not None else e)
    if spec.password:  # belt and braces: never echo the password
        raw = raw.replace(spec.password, "••••")
    messages = _messages(spec)
    key = _SQLSTATE.get(sqlstate or "") or _MYSQL_ERRNO.get(errno or 0)
    if key is None:
        plain = raw.lower().replace("can't", "cannot")
        plain = re.sub(r"\"[^\"]*\"|`[^`]*`|'[^']*'", "", plain)
        key = next((k for pattern, k in _TEXT_RULES if re.search(pattern, plain)), None)
    if key is not None:
        return messages[key]
    if type(orig).__name__ == "DataError":
        return "A value couldn't be read, such as an infinite date. Leave that column out or cast it to text with a query."
    first_line = raw.strip().splitlines()[0][:300] if raw.strip() else ""
    return first_line if orig is not None and first_line else "The database returned an error."
