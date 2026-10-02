#!/usr/bin/env bash
set -euo pipefail

readonly SOURCE_DIR="/home/pasha-deploy/incoming/backend"
readonly TARGET_DIR="/opt/pasha-music-backend"
readonly RELEASE_DIR="/opt/pasha-music-backend.next"
readonly BACKUP_DIR="/opt/pasha-music-backend.previous"
readonly SERVICE_NAME="pasha-music"
readonly SERVICE_USER="pasha-music"

exec 9>/run/lock/pasha-music-deploy.lock
flock -n 9 || { echo "Another backend deployment is running" >&2; exit 1; }

test -f "$SOURCE_DIR/package.json"
test -f "$SOURCE_DIR/package-lock.json"
test -f "$SOURCE_DIR/src/server.js"

rm -rf "$RELEASE_DIR"
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$RELEASE_DIR"
rsync -a --delete --exclude node_modules/ "$SOURCE_DIR/" "$RELEASE_DIR/"
chown -R "$SERVICE_USER:$SERVICE_USER" "$RELEASE_DIR"

sudo -u "$SERVICE_USER" npm --prefix "$RELEASE_DIR" ci --omit=dev --ignore-scripts

rm -rf "$BACKUP_DIR"
if test -d "$TARGET_DIR"; then mv "$TARGET_DIR" "$BACKUP_DIR"; fi
mv "$RELEASE_DIR" "$TARGET_DIR"

if systemctl restart "$SERVICE_NAME" && \
  curl --fail --silent --show-error --retry 8 --retry-delay 2 http://127.0.0.1:8787/healthz >/dev/null; then
  rm -rf "$BACKUP_DIR"
  echo "Backend deployment completed"
  exit 0
fi

echo "Health check failed; rolling back" >&2
systemctl stop "$SERVICE_NAME" || true
rm -rf "$TARGET_DIR"
if test -d "$BACKUP_DIR"; then mv "$BACKUP_DIR" "$TARGET_DIR"; fi
systemctl start "$SERVICE_NAME"
exit 1
