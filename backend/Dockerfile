# API (also used for beat and flower): no browser needed.
FROM python:3.13-slim AS api
WORKDIR /app
# Security fixes newer than the base image: zlib1g (CVE-2026-85091) and the image's own setuptools (CVE-2025-47273).
RUN apt-get update && apt-get install -y --no-install-recommends --only-upgrade zlib1g && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir --upgrade "setuptools>=78.1.1"
COPY requirements.txt .
# pip is only needed to build the image. It carries its own old copies of msgpack, setuptools and urllib3
# (pip/_vendor) that image scans flag, and nothing runs it at runtime, so it is removed afterwards.
RUN pip install --no-cache-dir -r requirements.txt && python -m pip uninstall -y pip
COPY . .
EXPOSE 8000
# WEB_CONCURRENCY API processes (default 2): one Python process uses one core, so a heavy upload or
# dashboard no longer slows every other request. Scheduled jobs are claimed in the database, so
# several processes never run the same one.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-2}"]

# Worker: the same app plus headless Chromium, which renders PDF reports from the print page.
FROM api AS worker
RUN playwright install --with-deps chromium
CMD ["celery", "-A", "app.worker", "worker", "--loglevel=info"]
