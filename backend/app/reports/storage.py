"""Where generated report files live.

Keys are built by the server ("<workspace_id>/<run_id>.<ext>"), never from user input.
Local storage keeps files under DATA_DIR/reports, which the API and worker containers share as
one volume. S3 storage (REPORT_STORAGE=s3) works with AWS S3 or any compatible store, such as a
self-hosted MinIO; it needs boto3.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Iterator
from functools import lru_cache

from app.config import get_settings

CHUNK = 64 * 1024


class LocalStorage:
    def __init__(self, root: str) -> None:
        self.root = os.path.abspath(root)

    def _path(self, key: str) -> str:
        path = os.path.abspath(os.path.join(self.root, key))
        if not path.startswith(self.root + os.sep):
            raise ValueError("bad storage key")
        return path

    def put(self, key: str, src_path: str) -> None:
        dest = self._path(key)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(src_path, dest)

    def local_path(self, key: str) -> str | None:
        path = self._path(key)
        return path if os.path.exists(path) else None

    def stream(self, key: str) -> Iterator[bytes]:
        with open(self._path(key), "rb") as f:
            while chunk := f.read(CHUNK):
                yield chunk

    def read(self, key: str) -> bytes:
        with open(self._path(key), "rb") as f:
            return f.read()

    def delete(self, key: str) -> None:
        try:
            os.remove(self._path(key))
        except FileNotFoundError:
            pass


class S3Storage:
    def __init__(self) -> None:
        import boto3  # optional dependency, only for REPORT_STORAGE=s3

        s = get_settings()
        if not s.s3_bucket:
            raise RuntimeError("REPORT_STORAGE=s3 needs S3_BUCKET")
        self.bucket = s.s3_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=s.s3_endpoint_url or None,
            region_name=s.s3_region,
            aws_access_key_id=s.s3_access_key or None,
            aws_secret_access_key=s.s3_secret_key or None,
        )

    def put(self, key: str, src_path: str) -> None:
        self.client.upload_file(src_path, self.bucket, key)

    def local_path(self, key: str) -> str | None:
        return None

    def stream(self, key: str) -> Iterator[bytes]:
        body = self.client.get_object(Bucket=self.bucket, Key=key)["Body"]
        yield from body.iter_chunks(CHUNK)

    def read(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


@lru_cache
def _storage(kind: str, root: str) -> LocalStorage | S3Storage:
    return S3Storage() if kind == "s3" else LocalStorage(root)


def get_storage() -> LocalStorage | S3Storage:
    s = get_settings()
    return _storage(s.report_storage, os.path.join(s.data_dir, "reports"))
