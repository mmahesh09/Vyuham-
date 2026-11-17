"""SQL Lab join hints: real relationships are found from names plus value overlap, nothing leaks values."""

from app.joins import clear_cache, name_score
from tests.test_query import sign_in, upload

CUSTOMERS = ["Acme Co", "Bolt Ltd", "Cedar Inc", "Delta LLC", "Echo Labs"]
ORDERS = "Order ID,Customer,Amount\n" + "".join(
    f"{1000 + i},{CUSTOMERS[i % len(CUSTOMERS)]},{100 + i}\n" for i in range(15)
)
COMPANIES = "company_name,Region\n" + "".join(f"{c},{r}\n" for c, r in zip(CUSTOMERS, ["North", "South", "East", "West", "North"]))
# Same companies, written differently: only match after lower-casing and trimming.
MESSY = "Client,Tier\n" + "".join(f"  {c.upper()} ,Gold\n" for c in CUSTOMERS)
PRODUCTS = "Product,Price\n" + "".join(f"Widget {i},{i * 10}\n" for i in range(12))


def setup_function():
    clear_cache()


def test_names_that_mean_the_same_thing_score():
    assert name_score("Customer", "customer") == 1.0
    assert name_score("Customer", "company_name") > 0.5  # synonyms, "name" ignored
    assert name_score("order_id", "Order No") > 0.5
    assert name_score("Amount", "Region") == 0
    assert name_score("id", "name") == 0  # only generic words: no evidence of meaning


def test_a_real_relationship_is_found_with_cardinality(client, engine):
    sign_in(client, engine)
    upload(client, ORDERS.encode(), "orders.csv")
    upload(client, COMPANIES.encode(), "customers.csv")
    upload(client, PRODUCTS.encode(), "products.csv")
    r = client.get("/sql/schema/joins")
    assert r.status_code == 200, r.text
    hints = r.json()
    match = [h for h in hints if {h["left_column"], h["right_column"]} == {"Customer", "company_name"}]
    assert match, hints
    h = match[0]
    assert h["overlap"] == 1.0 and h["normalized"] is False
    # orders -> customers: many orders per company, one row per company.
    assert h["cardinality"] in ("many_to_one", "one_to_many")
    assert 'JOIN "' in h["sql"] and '"Customer"' in h["sql"] and '"company_name"' in h["sql"]
    # Unrelated datasets and money columns are never suggested.
    assert not any("products" in (x["left_table"], x["right_table"]) for x in hints)
    assert not any("Amount" in (x["left_column"], x["right_column"]) for x in hints)
    # No customer values in the response, only names and percentages.
    assert not any(c in r.text for c in CUSTOMERS)

    # The suggested JOIN actually runs in SQL Lab.
    run = client.post("/sql/run", json={"sql": f'SELECT COUNT(*) AS n {h["sql"]}'})
    assert run.status_code == 200, run.text
    assert run.json()["rows"] == [{"n": 15}]


def test_values_that_only_match_after_trimming_are_flagged(client, engine):
    sign_in(client, engine)
    upload(client, ORDERS.encode(), "orders.csv")
    upload(client, MESSY.encode(), "clients.csv")
    hints = client.get("/sql/schema/joins").json()
    h = next(x for x in hints if {x["left_column"], x["right_column"]} == {"Customer", "Client"})
    assert h["normalized"] is True
    assert "lower(trim(" in h["sql"]
    assert client.post("/sql/run", json={"sql": f'SELECT COUNT(*) AS n {h["sql"]}'}).json()["rows"] == [{"n": 15}]


def test_no_hints_with_a_single_dataset(client, engine):
    sign_in(client, engine)
    upload(client, ORDERS.encode(), "orders.csv")
    assert client.get("/sql/schema/joins").json() == []
