"""S3 report storage, against a local S3 (MiniStack). Skipped unless S3_TEST_ENDPOINT is set.

    pip install ministack && ministack            # or: docker compose --profile dev up s3
    S3_TEST_ENDPOINT=http://localhost:4566 pytest tests/test_storage_s3.py
"""

import os

import pytest

ENDPOINT = os.environ.get("S3_TEST_ENDPOINT")
pytestmark = pytest.mark.skipif(not ENDPOINT, reason="set S3_TEST_ENDPOINT to run against a local S3")
BUCKET = "vyuham-reports-test"


@pytest.fixture
def s3_storage(monkeypatch):
    boto3 = pytest.importorskip("boto3")
    from app.config import get_settings
    from app.reports import storage

    s = get_settings()
    for attr, value in {
        "report_storage": "s3",
        "s3_bucket": BUCKET,
        "s3_endpoint_url": ENDPOINT,
        "s3_region": "us-east-1",
        "s3_access_key": "test",
        "s3_secret_key": "test",
    }.items():
        monkeypatch.setattr(s, attr, value)
    client = boto3.client("s3", endpoint_url=ENDPOINT, region_name="us-east-1", aws_access_key_id="test", aws_secret_access_key="test")
    try:
        client.create_bucket(Bucket=BUCKET)
    except client.exceptions.BucketAlreadyOwnedByYou:
        pass
    storage._storage.cache_clear()
    yield storage.get_storage()
    storage._storage.cache_clear()


def test_s3_round_trip(s3_storage, tmp_path):
    from app.reports.storage import S3Storage

    assert isinstance(s3_storage, S3Storage)
    src = tmp_path / "report.csv"
    src.write_bytes(b"Region,Amount\nNorth,100\n" * 20_000)  # ~480 KB: more than one stream chunk
    key = "ws1/run1.csv"

    s3_storage.put(key, str(src))
    assert s3_storage.local_path(key) is None  # downloads stream from S3, never a local path
    assert s3_storage.read(key) == src.read_bytes()
    assert b"".join(s3_storage.stream(key)) == src.read_bytes()

    s3_storage.delete(key)
    with pytest.raises(Exception):
        s3_storage.read(key)
