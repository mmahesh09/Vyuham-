#!/usr/bin/env sh
# Nightly backup of the data volume (uploaded datasets as Parquet, generated report files).
# Datasets exist only on this volume, so run this from cron, e.g.:
#   15 2 * * *  cd /opt/vyuham && ./deploy/backup-data.sh >> /var/log/vyuham-backup.log 2>&1
# Keeps 14 days locally in $BACKUP_DIR; with BACKUP_S3_URI set (in .env.prod), also copies each file
# there using the aws CLI. Postgres is backed up by your managed provider.
set -eu

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-/var/backups/vyuham}"
KEEP_DAYS="${KEEP_DAYS:-14}"
VOLUME="vyuham_appdata"  # docker-compose.prod.yml sets `name: vyuham`
STAMP="$(date -u +%Y-%m-%dT%H%MZ)"
FILE="data-$STAMP.tar.gz"

BACKUP_S3_URI="${BACKUP_S3_URI:-$(sed -n 's/^BACKUP_S3_URI=//p' .env.prod 2>/dev/null | tail -n 1)}"

mkdir -p "$BACKUP_DIR"
docker volume inspect "$VOLUME" >/dev/null
docker run --rm -v "$VOLUME":/data:ro -v "$BACKUP_DIR":/backup alpine:3.20 \
  tar -czf "/backup/$FILE" -C /data .
echo "$(date -u) wrote $BACKUP_DIR/$FILE ($(du -h "$BACKUP_DIR/$FILE" | cut -f1))"

if [ -n "$BACKUP_S3_URI" ]; then
  aws s3 cp "$BACKUP_DIR/$FILE" "$BACKUP_S3_URI/$FILE"
  echo "$(date -u) copied to $BACKUP_S3_URI/$FILE"
fi

find "$BACKUP_DIR" -name 'data-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
