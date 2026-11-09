# API (also used for beat and flower): no browser needed.
FROM python:3.13-slim AS api
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]

# Worker: the same app plus headless Chromium, which renders PDF reports from the print page.
FROM api AS worker
RUN playwright install --with-deps chromium
CMD ["celery", "-A", "app.worker", "worker", "--loglevel=info"]
