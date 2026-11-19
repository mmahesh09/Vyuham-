"""The formula language behind metrics and calculated columns.

Formulas are parsed by the small grammar below and rebuilt as DuckDB SQL. Nothing the user typed reaches
the database as SQL: only known operators and functions are accepted, columns are resolved against the
dataset and quoted, and strings are re-escaped. A formula that isn't understood is an error, never a
pass-through.

    SUM([amount])
    DIVIDE([Revenue], [Total Orders])
    IF([status] = 'paid', [amount], 0)
    CASE WHEN [amount] > 100 THEN 'large' ELSE 'small' END

Inside an aggregate, `[name]` is a column. Elsewhere in a measure it is a metric if one has that name.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

MAX_LENGTH = 2_000
MAX_TOKENS = 400
MAX_DEPTH = 30
MAX_METRIC_DEPTH = 8
DATE_UNITS = ("day", "week", "month", "quarter", "year")
KEYWORDS = {"and", "or", "not", "is", "null", "in", "true", "false", "case", "when", "then", "else", "end"}
TOKEN = re.compile(
    r"(?P<space>\s+)|(?P<number>\d+(?:\.\d+)?)|(?P<string>'(?:[^']|'')*')|(?P<bracket>\[(?:[^\]\n]|\]\])+\])"
    r"|(?P<name>[A-Za-z_][A-Za-z0-9_]*)|(?P<op><>|!=|<=|>=|[-+*/%(),=<>])"
)

Kind = Literal["measure", "column"]

FUNCTIONS: list[dict[str, str]] = [
    {"name": "SUM", "signature": "SUM(column)", "group": "Aggregate", "help": "Adds up the values."},
    {"name": "AVERAGE", "signature": "AVERAGE(column)", "group": "Aggregate", "help": "The mean of the values."},
    {"name": "COUNT", "signature": "COUNT() or COUNT(column)", "group": "Aggregate", "help": "Counts rows, or non-empty values."},
    {"name": "COUNT_DISTINCT", "signature": "COUNT_DISTINCT(column)", "group": "Aggregate", "help": "Counts different values."},
    {"name": "MIN", "signature": "MIN(column)", "group": "Aggregate", "help": "The lowest value."},
    {"name": "MAX", "signature": "MAX(column)", "group": "Aggregate", "help": "The highest value."},
    {"name": "IF", "signature": "IF(condition, then, otherwise)", "group": "Logic", "help": "Chooses between two values."},
    {"name": "COALESCE", "signature": "COALESCE(a, b, ...)", "group": "Logic", "help": "The first value that isn't empty."},
    {"name": "DIVIDE", "signature": "DIVIDE(a, b, if_zero)", "group": "Math", "help": "Divides safely. Dividing by zero gives if_zero, or empty."},
    {"name": "ROUND", "signature": "ROUND(number, digits)", "group": "Math", "help": "Rounds to a number of decimal places."},
    {"name": "ABS", "signature": "ABS(number)", "group": "Math", "help": "Removes the minus sign."},
    {"name": "YEAR", "signature": "YEAR(date)", "group": "Date", "help": "The year of a date."},
    {"name": "MONTH", "signature": "MONTH(date)", "group": "Date", "help": "The month number of a date."},
    {"name": "DAY", "signature": "DAY(date)", "group": "Date", "help": "The day of the month."},
    {"name": "DATE_DIFF", "signature": "DATE_DIFF('day', start, end)", "group": "Date", "help": "Time between two dates."},
    {"name": "DATE_TRUNC", "signature": "DATE_TRUNC('month', date)", "group": "Date", "help": "The start of the period."},
    {"name": "RUNNING_TOTAL", "signature": "RUNNING_TOTAL(number, order_by, partition)", "group": "Window", "help": "Calculated columns: a cumulative sum."},
    {"name": "LAG", "signature": "LAG(value, order_by, offset)", "group": "Window", "help": "Calculated columns: the value from an earlier row."},
    {"name": "LEAD", "signature": "LEAD(value, order_by, offset)", "group": "Window", "help": "Calculated columns: the value from a later row."},
]
AGGREGATES = {"SUM": "SUM", "AVERAGE": "AVG", "MIN": "MIN", "MAX": "MAX"}


class FormulaError(ValueError):
    def __init__(self, message: str, start: int = 0, end: int = 0) -> None:
        super().__init__(message)
        self.message, self.start, self.end = message, start, end


@dataclass
class Scope:
    columns: list[dict]
    kind: Kind = "measure"
    # A metric's name -> (its proper name, its formula), or None.
    metric: Callable[[str], tuple[str, str] | None] = lambda _name: None


@dataclass
class Compiled:
    sql: str
    type: str  # number | category | date
    level: str  # const | row | window | agg
    columns: set[str] = field(default_factory=set)
    metrics: set[str] = field(default_factory=set)


@dataclass
class _Val:
    sql: str
    type: str  # number | text | date | bool | null
    level: str
    literal: object = None


@dataclass(frozen=True)
class _Tok:
    kind: str
    text: str
    start: int
    end: int


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _tokenize(text: str) -> list[_Tok]:
    tokens: list[_Tok] = []
    at = 0
    while at < len(text):
        m = TOKEN.match(text, at)
        if m is None:
            hint = "This string or [name] isn't closed." if text[at] in "'[" else f"“{text[at]}” can't be used here."
            raise FormulaError(hint, at, at + 1)
        if m.lastgroup != "space":
            tokens.append(_Tok(m.lastgroup or "", m.group(), at, m.end()))
            if len(tokens) > MAX_TOKENS:
                raise FormulaError("This formula is too long.", at, m.end())
        at = m.end()
    return tokens


class _Parser:
    def __init__(self, text: str, scope: Scope, stack: tuple[str, ...]) -> None:
        self.text, self.scope, self.stack = text, scope, stack
        self.tokens = _tokenize(text)
        self.at = 0
        self.depth = 0
        self.in_aggregate = 0
        self.columns: set[str] = set()
        self.metrics: set[str] = set()
        self.by_name = {c["name"]: c for c in scope.columns}
        self.by_lower: dict[str, dict | None] = {}
        for c in scope.columns:
            key = c["name"].lower()
            self.by_lower[key] = None if key in self.by_lower else c  # None: two columns differ only by case

    # ---------- tokens ----------

    def peek(self) -> _Tok | None:
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def fail(self, message: str, tok: _Tok | None = None) -> FormulaError:
        tok = tok or self.peek()
        return FormulaError(message, tok.start, tok.end) if tok else FormulaError(message, len(self.text), len(self.text))

    def word(self, *words: str) -> bool:
        tok = self.peek()
        if tok and tok.kind == "name" and tok.text.lower() in words:
            self.at += 1
            return True
        return False

    def op(self, *ops: str) -> str | None:
        tok = self.peek()
        if tok and tok.kind == "op" and tok.text in ops:
            self.at += 1
            return tok.text
        return None

    def need_op(self, text: str) -> None:
        if not self.op(text):
            raise self.fail(f"Expected “{text}” here.")

    def need_word(self, word: str) -> None:
        if not self.word(word):
            raise self.fail(f"Expected {word.upper()} here.")

    # ---------- checks ----------

    def level(self, values: list[_Val], tok: _Tok | None) -> str:
        levels = {v.level for v in values} - {"const"}
        if len(levels) > 1:
            raise self.fail("This mixes single-row values with totals. Wrap the column in SUM, COUNT or another aggregate.", tok)
        return next(iter(levels), "const")

    def expect(self, v: _Val, types: tuple[str, ...], what: str, tok: _Tok | None) -> None:
        if v.type != "null" and v.type not in types:
            names = {"number": "a number", "date": "a date", "text": "text", "bool": "a true or false condition"}
            raise self.fail(f"{what} needs {' or '.join(names[t] for t in types)}.", tok)

    def unify(self, values: list[_Val], what: str, tok: _Tok | None) -> str:
        kinds = {v.type for v in values} - {"null"}
        if len(kinds) > 1:
            raise self.fail(f"{what} mixes different kinds of value.", tok)
        return next(iter(kinds), "null")

    # ---------- grammar ----------

    def expr(self) -> _Val:
        self.depth += 1
        if self.depth > MAX_DEPTH:
            raise self.fail("This formula is nested too deeply.")
        try:
            return self.or_expr()
        finally:
            self.depth -= 1

    def _logic(self, word: str, next_level: Callable[[], _Val]) -> _Val:
        left = next_level()
        while True:
            tok = self.peek()
            if not self.word(word):
                return left
            right = next_level()
            for side in (left, right):
                self.expect(side, ("bool",), word.upper(), tok)
            left = _Val(f"({left.sql} {word.upper()} {right.sql})", "bool", self.level([left, right], tok))

    def or_expr(self) -> _Val:
        return self._logic("or", self.and_expr)

    def and_expr(self) -> _Val:
        return self._logic("and", self.not_expr)

    def not_expr(self) -> _Val:
        tok = self.peek()
        if self.word("not"):
            v = self.not_expr()
            self.expect(v, ("bool",), "NOT", tok)
            return _Val(f"(NOT {v.sql})", "bool", v.level)
        return self.comparison()

    def comparable(self, left: _Val, right: _Val, tok: _Tok | None) -> tuple[_Val, _Val]:
        """A date can be compared with 'YYYY-MM-DD' text."""
        def as_date(v: _Val) -> _Val:
            try:
                date.fromisoformat(str(v.literal))
            except ValueError:
                raise self.fail("Write dates as 'YYYY-MM-DD'.", tok) from None
            return _Val(f"CAST({v.sql} AS TIMESTAMP)", "date", "const")

        if left.type == "date" and right.type == "text" and right.literal is not None:
            right = as_date(right)
        elif right.type == "date" and left.type == "text" and left.literal is not None:
            left = as_date(left)
        self.unify([left, right], "This comparison", tok)
        return left, right

    def comparison(self) -> _Val:
        left = self.additive()
        tok = self.peek()
        if self.word("is"):
            negated = self.word("not")
            self.need_word("null")
            return _Val(f"({left.sql} IS {'NOT ' if negated else ''}NULL)", "bool", left.level)
        start = self.at
        negated = self.word("not")
        if self.word("in"):
            self.need_op("(")
            items = [self.expr()]
            while self.op(","):
                items.append(self.expr())
            self.need_op(")")
            items = [self.comparable(left, v, tok)[1] for v in items]
            level = self.level([left, *items], tok)
            return _Val(f"({left.sql} {'NOT ' if negated else ''}IN ({', '.join(v.sql for v in items)}))", "bool", level)
        self.at = start
        symbol = self.op("=", "<>", "!=", "<", "<=", ">", ">=")
        if not symbol:
            return left
        right = self.additive()
        left, right = self.comparable(left, right, tok)
        return _Val(f"({left.sql} {'<>' if symbol == '!=' else symbol} {right.sql})", "bool", self.level([left, right], tok))

    def additive(self) -> _Val:
        left = self.multiplicative()
        while True:
            tok = self.peek()
            symbol = self.op("+", "-")
            if not symbol:
                return left
            right = self.multiplicative()
            for side in (left, right):
                self.expect(side, ("number",), f"“{symbol}”", tok)
            left = _Val(f"({left.sql} {symbol} {right.sql})", "number", self.level([left, right], tok))

    def multiplicative(self) -> _Val:
        left = self.unary()
        while True:
            tok = self.peek()
            symbol = self.op("*", "/", "%")
            if not symbol:
                return left
            right = self.unary()
            for side in (left, right):
                self.expect(side, ("number",), f"“{symbol}”", tok)
            divisor = right.sql if symbol == "*" else f"NULLIF({right.sql}, 0)"  # dividing by zero gives empty
            left = _Val(f"({left.sql} {symbol} {divisor})", "number", self.level([left, right], tok))

    def unary(self) -> _Val:
        tok = self.peek()
        if self.op("-"):
            v = self.unary()
            self.expect(v, ("number",), "“-”", tok)
            return _Val(f"(-{v.sql})", "number", v.level, -v.literal if isinstance(v.literal, (int, float)) else None)
        return self.primary()

    def primary(self) -> _Val:
        tok = self.peek()
        if tok is None:
            raise self.fail("The formula ends too early.")
        if tok.kind == "number":
            self.at += 1
            return _Val(tok.text, "number", "const", float(tok.text))
        if tok.kind == "string":
            self.at += 1
            value = tok.text[1:-1].replace("''", "'")
            return _Val(_string(value), "text", "const", value)
        if tok.kind == "bracket":
            self.at += 1
            return self.reference(tok.text[1:-1].replace("]]", "]"), tok)
        if self.op("("):
            v = self.expr()
            self.need_op(")")
            return v
        if tok.kind != "name":
            raise self.fail(f"“{tok.text}” can't go here.")
        lower = tok.text.lower()
        if lower in ("true", "false"):
            self.at += 1
            return _Val(lower.upper(), "bool", "const")
        if lower == "null":
            self.at += 1
            return _Val("NULL", "null", "const")
        if lower == "case":
            self.at += 1
            return self.case(tok)
        if lower in KEYWORDS:
            raise self.fail(f"{tok.text.upper()} can't go here.")
        self.at += 1
        following = self.peek()
        if following and following.text == "(":
            return self.call(tok)
        return self.reference(tok.text, tok)

    def case(self, tok: _Tok) -> _Val:
        conditions, results, parts = [], [], []
        while self.word("when"):
            cond = self.expr()
            self.expect(cond, ("bool",), "WHEN", tok)
            self.need_word("then")
            result = self.expr()
            conditions.append(cond)
            results.append(result)
            parts.append(f"WHEN {cond.sql} THEN {result.sql}")
        if not parts:
            raise self.fail("CASE needs at least one WHEN.", tok)
        if self.word("else"):
            otherwise = self.expr()
            results.append(otherwise)
            parts.append(f"ELSE {otherwise.sql}")
        self.need_word("end")
        kind = self.unify(results, "CASE", tok)
        return _Val(f"(CASE {' '.join(parts)} END)", kind, self.level([*conditions, *results], tok))

    def column(self, name: str) -> dict | None:
        return self.by_name.get(name) or self.by_lower.get(name.lower())

    def reference(self, name: str, tok: _Tok) -> _Val:
        if self.scope.kind == "measure" and not self.in_aggregate:
            found = self.scope.metric(name)
            if found:
                return self.metric(found, tok)
        col = self.column(name)
        if col is None:
            raise self.fail(f"There's no column or metric called “{name}”.", tok)
        self.columns.add(col["name"])
        kind = {"number": "number", "date": "date"}.get(col["type"], "text")
        if self.scope.kind == "column" and col.get("sql"):
            if col.get("window"):
                raise self.fail(f"“{col['name']}” uses a running calculation, so other columns can't build on it.", tok)
            return _Val(f"({col['sql']})", kind, "row")
        return _Val(_quote(col["name"]), kind, "row")

    def metric(self, found: tuple[str, str], tok: _Tok) -> _Val:
        name, formula = found
        if name.lower() in self.stack:
            raise self.fail(f"“{name}” ends up depending on itself.", tok)
        if len(self.stack) >= MAX_METRIC_DEPTH:
            raise self.fail("Too many metrics are stacked on each other here.", tok)
        try:
            inner = compile_formula(formula, self.scope, (*self.stack, name.lower()))
        except FormulaError as e:
            raise self.fail(f"In “{name}”: {e.message}", tok) from e
        self.columns |= inner.columns
        self.metrics |= {name, *inner.metrics}
        return _Val(f"({inner.sql})", "number", "agg")

    # ---------- functions ----------

    def arguments(self, aggregate: bool = False) -> list[_Val]:
        self.need_op("(")
        self.in_aggregate += int(aggregate)
        try:
            out: list[_Val] = []
            if not self.op(")"):
                out.append(self.expr())
                while self.op(","):
                    out.append(self.expr())
                self.need_op(")")
            return out
        finally:
            self.in_aggregate -= int(aggregate)

    def arity(self, name: str, args: list, low: int, high: int, tok: _Tok) -> None:
        if not low <= len(args) <= high:
            want = str(low) if low == high else f"{low} to {high}"
            raise self.fail(f"{name} takes {want} value{'s' if high != 1 else ''}.", tok)

    def aggregate(self, name: str, tok: _Tok) -> _Val:
        if self.scope.kind == "column":
            raise self.fail(f"{name} adds up many rows, so it belongs in a metric, not a calculated column.", tok)
        following = self.tokens[self.at + 1] if self.at + 1 < len(self.tokens) else None
        if name == "COUNT" and following and following.text == "*":  # COUNT(*)
            self.at += 2
            self.need_op(")")
            return _Val("COUNT(*)", "number", "agg")
        args = self.arguments(aggregate=True)
        if name == "COUNT" and not args:
            return _Val("COUNT(*)", "number", "agg")
        self.arity(name, args, 1, 1, tok)
        v = args[0]
        if v.level in ("agg", "window"):
            raise self.fail(f"{name} can't contain another total.", tok)
        if name == "COUNT":
            return _Val(f"COUNT({v.sql})", "number", "agg")
        if name == "COUNT_DISTINCT":
            return _Val(f"COUNT(DISTINCT {v.sql})", "number", "agg")
        if name in ("SUM", "AVERAGE"):
            self.expect(v, ("number",), name, tok)
            return _Val(f"{AGGREGATES[name]}({v.sql})", "number", "agg")
        self.expect(v, ("number", "date", "text"), name, tok)
        return _Val(f"{AGGREGATES[name]}({v.sql})", v.type, "agg")

    def window(self, name: str, tok: _Tok) -> _Val:
        if self.scope.kind == "measure":
            raise self.fail(f"{name} works row by row, so use it in a calculated column.", tok)
        args = self.arguments()
        self.arity(name, args, 2, 3, tok)
        if any(a.level == "window" for a in args):
            raise self.fail(f"{name} can't contain another running calculation.", tok)
        value, order = args[0], args[1]
        if name == "RUNNING_TOTAL":
            self.expect(value, ("number",), name, tok)
            partition = f"PARTITION BY {args[2].sql} " if len(args) == 3 else ""
            return _Val(f"SUM({value.sql}) OVER ({partition}ORDER BY {order.sql} ROWS UNBOUNDED PRECEDING)", "number", "window")
        offset = 1
        if len(args) == 3:
            literal = args[2].literal
            if not isinstance(literal, float) or literal != int(literal) or not 1 <= literal <= 1000:
                raise self.fail(f"{name}'s offset must be a whole number from 1 to 1000.", tok)
            offset = int(literal)
        return _Val(f"{name}({value.sql}, {offset}) OVER (ORDER BY {order.sql})", value.type, "window")

    def unit(self, v: _Val, name: str, tok: _Tok) -> str:
        unit = str(v.literal).lower() if v.type == "text" else ""
        if unit not in DATE_UNITS:
            raise self.fail(f"{name} starts with one of: {', '.join(repr(u) for u in DATE_UNITS)}.", tok)
        return unit

    def call(self, tok: _Tok) -> _Val:
        name = tok.text.upper()
        if name in (*AGGREGATES, "COUNT", "COUNT_DISTINCT"):
            return self.aggregate(name, tok)
        if name in ("RUNNING_TOTAL", "LAG", "LEAD"):
            return self.window(name, tok)
        if name not in {f["name"] for f in FUNCTIONS}:
            raise self.fail(f"There's no function called {tok.text}.", tok)
        args = self.arguments()
        level = self.level(args, tok)
        if name == "IF":
            self.arity(name, args, 2, 3, tok)
            self.expect(args[0], ("bool",), "IF", tok)
            kind = self.unify(args[1:], "IF", tok)
            otherwise = f" ELSE {args[2].sql}" if len(args) == 3 else ""
            return _Val(f"(CASE WHEN {args[0].sql} THEN {args[1].sql}{otherwise} END)", kind, level)
        if name == "COALESCE":
            if not args:
                raise self.fail("COALESCE needs at least one value.", tok)
            return _Val(f"COALESCE({', '.join(a.sql for a in args)})", self.unify(args, name, tok), level)
        if name == "DIVIDE":
            self.arity(name, args, 2, 3, tok)
            for a in args:
                self.expect(a, ("number",), name, tok)
            sql = f"({args[0].sql} / NULLIF({args[1].sql}, 0))"
            return _Val(f"COALESCE({sql}, {args[2].sql})" if len(args) == 3 else sql, "number", level)
        if name == "ROUND":
            self.arity(name, args, 1, 2, tok)
            self.expect(args[0], ("number",), name, tok)
            digits = 0
            if len(args) == 2:
                literal = args[1].literal
                if not isinstance(literal, float) or literal != int(literal) or abs(literal) > 12:
                    raise self.fail("ROUND's digits must be a whole number from -12 to 12.", tok)
                digits = int(literal)
            return _Val(f"ROUND({args[0].sql}, {digits})", "number", level)
        if name == "ABS":
            self.arity(name, args, 1, 1, tok)
            self.expect(args[0], ("number",), name, tok)
            return _Val(f"ABS({args[0].sql})", "number", level)
        if name in ("YEAR", "MONTH", "DAY"):
            self.arity(name, args, 1, 1, tok)
            self.expect(args[0], ("date",), name, tok)
            return _Val(f"{name.lower()}({args[0].sql})", "number", level)
        if name == "DATE_DIFF":
            self.arity(name, args, 3, 3, tok)
            unit = self.unit(args[0], name, tok)
            for a in args[1:]:
                self.expect(a, ("date",), name, tok)
            return _Val(f"date_diff('{unit}', {args[1].sql}, {args[2].sql})", "number", level)
        self.arity(name, args, 2, 2, tok)  # DATE_TRUNC
        unit = self.unit(args[0], name, tok)
        self.expect(args[1], ("date",), name, tok)
        return _Val(f"date_trunc('{unit}', {args[1].sql})", "date", level)


def compile_formula(text: str, scope: Scope, stack: tuple[str, ...] = ()) -> Compiled:
    """DuckDB SQL for a formula, or FormulaError with the position of the problem."""
    text = text or ""
    if not text.strip():
        raise FormulaError("Write a formula.")
    if len(text) > MAX_LENGTH:
        raise FormulaError("This formula is too long.", MAX_LENGTH, len(text))
    parser = _Parser(text, scope, stack)
    try:
        v = parser.expr()
    except RecursionError:
        raise FormulaError("This formula is nested too deeply.") from None
    extra = parser.peek()
    if extra is not None:
        raise parser.fail(f"“{extra.text}” wasn't expected here.", extra)
    if scope.kind == "measure":
        if v.level != "agg":
            raise FormulaError("A metric has to total many rows. Use SUM, COUNT or another aggregate.", 0, len(text))
        if v.type not in ("number", "null"):
            raise FormulaError("A metric has to produce a number.", 0, len(text))
        return Compiled(v.sql, "number", v.level, parser.columns, parser.metrics)
    if v.type == "null":
        raise FormulaError("This column would always be empty.", 0, len(text))
    if v.type == "bool":
        return Compiled(f"CAST({v.sql} AS VARCHAR)", "category", v.level, parser.columns)
    return Compiled(v.sql, {"number": "number", "date": "date"}.get(v.type, "category"), v.level, parser.columns)
