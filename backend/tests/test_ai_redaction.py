"""What the AI Data Engineer may see of a failed run: engine errors quote cell values, which must not reach the provider."""

from app.governance import redact_error_values


def test_quoted_cell_values_are_dropped_but_columns_stay():
    out = redact_error_values("Conversion Error: Could not convert string 'Jane Doe' to INT32 in column \"amount\"")
    assert "Jane Doe" not in out
    assert "'[value]'" in out
    assert '"amount"' in out  # identifiers are double-quoted and still name the failing column


def test_escaped_quotes_and_personal_data():
    out = redact_error_values("value 'O''Brien' sent to jane@acme.com")
    assert "Brien" not in out
    assert "jane@acme.com" not in out


def test_text_without_values_is_unchanged():
    msg = 'Binder Error: Referenced column "amout" not found'
    assert redact_error_values(msg) == msg
