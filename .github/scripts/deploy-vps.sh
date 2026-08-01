#!/usr/bin/env bash

set -Eeuo pipefail

DEPLOY_BRANCH="${1:?Deploy branch is required}"
REBUILD_BACKEND="${2:?Backend rebuild flag is required}"
DEPLOY_MODE="${3:-deploy}"
RECLAIM_DOCKER_SPACE="${4:-false}"
EXPECTED_RELEASE_COMMIT="${5:?Immutable release commit is required}"
BACKEND_ROLLBACK_READY=false
API_ROLLBACK_IMAGE=""
PAYROLL_ROLLBACK_IMAGE=""

cleanup_deploy_artifacts() {
  rm -f /tmp/autoentry-client-app-deploy/frontend-build.tar.gz \
    /tmp/autoentry-client-app-deploy/frontend-build.tar.gz.sha256 \
    /tmp/autoentry-client-app-deploy/backend-images.tar.gz \
    /tmp/autoentry-client-app-deploy/backend-images.tar.gz.sha256
}

restore_previous_backend() {
  if [ "$BACKEND_ROLLBACK_READY" != "true" ]; then
    return
  fi
  echo "Restoring the previous healthy backend images"
  docker image tag "$API_ROLLBACK_IMAGE" autoentry-client-app-api:latest
  docker image tag "$PAYROLL_ROLLBACK_IMAGE" autoentry-client-app-payroll-worker:latest
  docker compose up -d --no-build payroll-worker api
  docker compose ps -a
  BACKEND_ROLLBACK_READY=false
}

deployment_error() {
  status=$?
  trap - ERR
  set +e
  echo "Deployment failed at line $1: $2 (exit $status)" >&2
  restore_previous_backend
  exit "$status"
}

trap cleanup_deploy_artifacts EXIT
trap 'deployment_error "$LINENO" "$BASH_COMMAND"' ERR

cd /opt/autoentry-client-app

if ! [[ "$EXPECTED_RELEASE_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid immutable release commit: $EXPECTED_RELEASE_COMMIT"
  exit 1
fi

echo "Verifying transferred release artifacts"
(cd /tmp/autoentry-client-app-deploy && sha256sum -c frontend-build.tar.gz.sha256)
if [ "$REBUILD_BACKEND" = "true" ]; then
  (cd /tmp/autoentry-client-app-deploy && sha256sum -c backend-images.tar.gz.sha256)
fi

DEPLOY_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_ROOT="$HOME/autoentry-deploy-backups/$DEPLOY_TIMESTAMP"
LEGACY_UPLOADS="/opt/autoentry-client-app/backend/uploads"
CURRENT_UPLOADS="/opt/autoentry-client-app/Client App/backend/uploads"

if [ -d "$LEGACY_UPLOADS" ] && [ "$REBUILD_BACKEND" != "true" ]; then
  echo "The legacy application layout is present. Re-run this deployment with rebuild_backend enabled."
  exit 1
fi

echo "Creating pre-deployment backup: $BACKUP_ROOT"
umask 077
mkdir -p "$BACKUP_ROOT"

echo "VPS resource preflight"
free -m
swapon --show
df -h /
MEM_TOTAL_KB="$(awk '/MemTotal:/ { print $2 }' /proc/meminfo)"
SWAP_TOTAL_KB="$(awk '/SwapTotal:/ { print $2 }' /proc/meminfo)"
if [ "$MEM_TOTAL_KB" -lt 1572864 ] && [ "$SWAP_TOTAL_KB" -lt 524288 ]; then
  echo "This VPS has less than 1.5 GB RAM and no adequate swap. Refusing to start a resource-heavy deployment."
  exit 1
fi
timeout 20 docker info >/dev/null

echo "Locating the existing MySQL container"
MYSQL_CONTAINER="$(timeout 15 docker compose ps -q mysql || true)"
if [ -z "$MYSQL_CONTAINER" ]; then
  echo "MySQL is not running; starting it before backup"
  timeout 90 docker compose up -d mysql
  MYSQL_CONTAINER="$(timeout 15 docker compose ps -q mysql || true)"
  if [ -z "$MYSQL_CONTAINER" ]; then
    echo "MySQL container could not be started; refusing to deploy without a database backup."
    exit 1
  fi
else
  echo "Reusing the running MySQL container; no restart required"
fi

MYSQL_READY=false
for attempt in $(seq 1 30); do
  if timeout 5 docker exec "$MYSQL_CONTAINER" sh -c 'mysqladmin ping -h127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent' >/dev/null 2>&1; then
    MYSQL_READY=true
    break
  fi
  echo "MySQL is not ready for backup yet ($attempt/30); waiting..."
  sleep 2
done
if [ "$MYSQL_READY" != "true" ]; then
  echo "MySQL did not become ready within one minute. Recent logs:"
  docker compose logs --tail=120 mysql
  exit 1
fi

echo "Database backup assessment"
timeout 15 docker exec "$MYSQL_CONTAINER" sh -c 'mysql -h127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" -D"$MYSQL_DATABASE" -N -e "SELECT COUNT(*) AS table_count, ROUND(COALESCE(SUM(data_length + index_length), 0) / 1024 / 1024, 2) AS size_mb FROM information_schema.tables WHERE table_schema = DATABASE();"'

DUMP_TEMP="$BACKUP_ROOT/mysql.sql.tmp"
rm -f "$DUMP_TEMP"
echo "Starting low-priority database backup (90-second limit)"
DUMP_STARTED="$(date +%s)"
DUMP_EXIT=0
nice -n 10 ionice -c2 -n7 timeout --kill-after=10 90 docker exec "$MYSQL_CONTAINER" sh -c 'exec mysqldump -h127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --quick --skip-lock-tables --no-tablespaces --hex-blob --routines --triggers "$MYSQL_DATABASE"' > "$DUMP_TEMP" || DUMP_EXIT=$?
DUMP_FINISHED="$(date +%s)"
DUMP_BYTES="$(stat -c %s "$DUMP_TEMP" 2>/dev/null || echo 0)"
echo "Database backup finished in $((DUMP_FINISHED - DUMP_STARTED)) seconds with exit $DUMP_EXIT and $DUMP_BYTES bytes"
if [ "$DUMP_EXIT" -ne 0 ] || [ "$DUMP_BYTES" -le 0 ]; then
  rm -f "$DUMP_TEMP"
  echo "Database backup failed within the 90-second safety limit; no deployment changes have been made."
  timeout 15 docker exec "$MYSQL_CONTAINER" sh -c 'mysql -h127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SHOW FULL PROCESSLIST;"' || true
  docker compose logs --tail=120 mysql
  exit 1
fi
mv "$DUMP_TEMP" "$BACKUP_ROOT/mysql.sql"

PAYROLL_DATA_DIR="/opt/autoentry-client-app/Payroll 2/data"
PAYROLL_DATABASE="$PAYROLL_DATA_DIR/payroll.sqlite"
if [ -f "$PAYROLL_DATABASE" ]; then
  echo "Creating a consistent payroll SQLite backup"
  PAYROLL_BACKUP_TEMP=".deployment-backup-$DEPLOY_TIMESTAMP.sqlite"
  PAYROLL_BACKUP_SCRIPT='const { DatabaseSync } = require("node:sqlite"); const source = new DatabaseSync("/data/payroll.sqlite"); source.exec("PRAGMA busy_timeout=60000"); const target = process.env.PAYROLL_BACKUP_PATH.replaceAll("\u0027", "\u0027\u0027"); source.exec(`VACUUM INTO \u0027${target}\u0027`); source.close(); const backup = new DatabaseSync(process.env.PAYROLL_BACKUP_PATH, { readOnly: true }); const result = backup.prepare("PRAGMA integrity_check").get(); backup.close(); if (result.integrity_check !== "ok") throw new Error(`Payroll backup integrity check failed: ${result.integrity_check}`);'
  PAYROLL_CONTAINER="$(timeout 15 docker compose ps -q payroll-worker || true)"
  if [ -n "$PAYROLL_CONTAINER" ] && [ "$(docker inspect -f '{{.State.Running}}' "$PAYROLL_CONTAINER" 2>/dev/null || echo false)" = "true" ]; then
    timeout 120 docker exec \
      -e "PAYROLL_BACKUP_PATH=/data/$PAYROLL_BACKUP_TEMP" \
      "$PAYROLL_CONTAINER" \
      node -e "$PAYROLL_BACKUP_SCRIPT"
  else
    echo "The payroll worker is stopped; using its current image for the consistent backup"
    timeout 120 docker run --rm \
      --entrypoint node \
      -v "$PAYROLL_DATA_DIR:/data" \
      -e "PAYROLL_BACKUP_PATH=/data/$PAYROLL_BACKUP_TEMP" \
      autoentry-client-app-payroll-worker:latest \
      -e "$PAYROLL_BACKUP_SCRIPT"
  fi
  mv "$PAYROLL_DATA_DIR/$PAYROLL_BACKUP_TEMP" "$BACKUP_ROOT/payroll.sqlite"
  sha256sum "$BACKUP_ROOT/payroll.sqlite" > "$BACKUP_ROOT/payroll.sqlite.sha256"
  echo "Payroll SQLite backup completed and passed integrity_check"
else
  echo "No payroll SQLite database exists yet; skipping payroll backup"
fi

LEGACY_UPLOAD_COUNT="$(find "$LEGACY_UPLOADS" -type f 2>/dev/null | wc -l)"
CURRENT_UPLOAD_COUNT_BEFORE="$(find "$CURRENT_UPLOADS" -type f 2>/dev/null | wc -l)"
if [ "$LEGACY_UPLOAD_COUNT" -gt "$CURRENT_UPLOAD_COUNT_BEFORE" ]; then
  echo "Legacy upload migration requires a one-time safety snapshot"
  mkdir -p "$BACKUP_ROOT/legacy-uploads"
  cp -al "$LEGACY_UPLOADS/." "$BACKUP_ROOT/legacy-uploads/"
else
  echo "Persistent uploads are already migrated; skipping duplicate document copies"
fi

{
  echo "branch=$DEPLOY_BRANCH"
  echo "commit_before=$(git rev-parse HEAD)"
  echo "created_utc=$DEPLOY_TIMESTAMP"
  echo "legacy_upload_files=$LEGACY_UPLOAD_COUNT"
  echo "current_upload_files=$CURRENT_UPLOAD_COUNT_BEFORE"
} > "$BACKUP_ROOT/manifest.txt"

if [ "$DEPLOY_MODE" = "preflight" ]; then
  echo "Deployment preflight completed successfully"
  exit 0
fi

echo "Syncing branch: $DEPLOY_BRANCH"
git fetch origin "$DEPLOY_BRANCH"
git checkout "$DEPLOY_BRANCH"
git reset --hard "origin/$DEPLOY_BRANCH"
if [ "$(git rev-parse HEAD)" != "$EXPECTED_RELEASE_COMMIT" ]; then
  echo "The branch moved after this release was built. Expected $EXPECTED_RELEASE_COMMIT but the VPS checked out $(git rev-parse HEAD). Refusing a mixed release; run the workflow again."
  exit 1
fi

echo "Preparing persistent upload storage"
mkdir -p "$CURRENT_UPLOADS"
if [ -d "$BACKUP_ROOT/legacy-uploads" ]; then
  cp -an "$BACKUP_ROOT/legacy-uploads/." "$CURRENT_UPLOADS/"
fi

echo "Checking payroll integration secret"
PAYROLL_SECRET="$(sed -n 's/^PAYROLL_INTEGRATION_SECRET=//p' .env | tail -n 1)"
if [ "${#PAYROLL_SECRET}" -lt 32 ]; then
  cp .env "$BACKUP_ROOT/env.before-payroll-secret"
  PAYROLL_SECRET="$(openssl rand -hex 32)"
  if grep -q '^PAYROLL_INTEGRATION_SECRET=' .env; then
    sed -i "s/^PAYROLL_INTEGRATION_SECRET=.*/PAYROLL_INTEGRATION_SECRET=$PAYROLL_SECRET/" .env
  else
    printf '\nPAYROLL_INTEGRATION_SECRET=%s\n' "$PAYROLL_SECRET" >> .env
  fi
  chmod 600 .env
  echo "Generated and persisted a new payroll integration secret"
else
  echo "Existing payroll integration secret is configured"
fi

CURRENT_UPLOAD_COUNT="$(find "$CURRENT_UPLOADS" -type f 2>/dev/null | wc -l)"
if [ "$CURRENT_UPLOAD_COUNT" -lt "$LEGACY_UPLOAD_COUNT" ]; then
  echo "Upload migration verification failed: expected at least $LEGACY_UPLOAD_COUNT files, found $CURRENT_UPLOAD_COUNT."
  exit 1
fi
echo "Upload migration verified: $CURRENT_UPLOAD_COUNT files available in the current upload path."

echo "Staging prebuilt frontend files without changing the live frontend"
FRONTEND_STAGING="/tmp/autoentry-client-app-deploy/frontend-build"
mkdir "$FRONTEND_STAGING"
tar -xzf /tmp/autoentry-client-app-deploy/frontend-build.tar.gz -C "$FRONTEND_STAGING"
if [ ! -s "$FRONTEND_STAGING/index.html" ]; then
  echo "The staged frontend has no index.html; refusing to replace the live frontend."
  exit 1
fi

echo "VPS is now on:"
git log --oneline -1
git status --short

if [ "$REBUILD_BACKEND" = "true" ]; then
  echo "Loading prebuilt backend images"
  ls -lh /tmp/autoentry-client-app-deploy/backend-images.tar.gz
  echo "Disk before Docker load:"
  df -h
  echo "Docker storage before Docker load:"
  docker system df || true

  # Docker needs temporary headroom while extracting layers. Space reclamation
  # is opt-in at workflow dispatch and retains running images plus every image
  # created during the last seven days for rollback.
  MIN_DOCKER_LOAD_FREE_KB="${MIN_DOCKER_LOAD_FREE_KB:-4194304}"
  FREE_BEFORE_CLEANUP_KB="$(df --output=avail -k / | tail -n 1 | tr -d ' ')"
  if [ "$FREE_BEFORE_CLEANUP_KB" -lt "$MIN_DOCKER_LOAD_FREE_KB" ] && [ "$RECLAIM_DOCKER_SPACE" = "true" ]; then
    echo "Only $((FREE_BEFORE_CLEANUP_KB / 1024)) MB is free; removing unused Docker images older than seven days as explicitly requested."
    docker image prune -af --filter "until=168h"
  fi
  FREE_AFTER_CLEANUP_KB="$(df --output=avail -k / | tail -n 1 | tr -d ' ')"
  echo "Free disk available for Docker load: $((FREE_AFTER_CLEANUP_KB / 1024)) MB"
  if [ "$FREE_AFTER_CLEANUP_KB" -lt "$MIN_DOCKER_LOAD_FREE_KB" ]; then
    echo "At least $((MIN_DOCKER_LOAD_FREE_KB / 1024)) MB free is required to unpack the backend release. Existing services have not been replaced."
    if [ "$RECLAIM_DOCKER_SPACE" != "true" ]; then
      echo "Re-run the workflow with 'Reclaim old unused Docker images' enabled after reviewing its rollback-retention description."
    fi
    exit 1
  fi

  load_started="$(date +%s)"
  timeout 600 sh -c 'gzip -dc /tmp/autoentry-client-app-deploy/backend-images.tar.gz | docker load'
  load_finished="$(date +%s)"
  echo "Docker images loaded in $((load_finished - load_started)) seconds"
  API_RELEASE_IMAGE="autoentry-client-app-api:$EXPECTED_RELEASE_COMMIT"
  PAYROLL_RELEASE_IMAGE="autoentry-client-app-payroll-worker:$EXPECTED_RELEASE_COMMIT"
  API_RELEASE_LABEL="$(docker image inspect --format '{{ index .Config.Labels "net.eposbookings.release.commit" }}' "$API_RELEASE_IMAGE")"
  PAYROLL_RELEASE_LABEL="$(docker image inspect --format '{{ index .Config.Labels "net.eposbookings.release.commit" }}' "$PAYROLL_RELEASE_IMAGE")"
  if [ "$API_RELEASE_LABEL" != "$EXPECTED_RELEASE_COMMIT" ] || [ "$PAYROLL_RELEASE_LABEL" != "$EXPECTED_RELEASE_COMMIT" ]; then
    echo "Backend release-label verification failed after Docker load."
    echo "API expected=$EXPECTED_RELEASE_COMMIT actual=$API_RELEASE_LABEL"
    echo "Payroll expected=$EXPECTED_RELEASE_COMMIT actual=$PAYROLL_RELEASE_LABEL"
    exit 1
  fi
  echo "Both backend images match immutable release $EXPECTED_RELEASE_COMMIT"
  API_ROLLBACK_IMAGE="autoentry-client-app-api:rollback-$DEPLOY_TIMESTAMP"
  PAYROLL_ROLLBACK_IMAGE="autoentry-client-app-payroll-worker:rollback-$DEPLOY_TIMESTAMP"
  if docker image inspect autoentry-client-app-api:latest >/dev/null 2>&1 && docker image inspect autoentry-client-app-payroll-worker:latest >/dev/null 2>&1; then
    docker image tag autoentry-client-app-api:latest "$API_ROLLBACK_IMAGE"
    docker image tag autoentry-client-app-payroll-worker:latest "$PAYROLL_ROLLBACK_IMAGE"
    BACKEND_ROLLBACK_READY=true
    echo "Previous backend images retained as rollback-$DEPLOY_TIMESTAMP"
  fi
  docker image tag "$API_RELEASE_IMAGE" autoentry-client-app-api:latest
  docker image tag "$PAYROLL_RELEASE_IMAGE" autoentry-client-app-payroll-worker:latest
  docker compose up -d --no-build payroll-worker api
fi

echo "Payroll worker health check"
for attempt in $(seq 1 60); do
  PAYROLL_CONTAINER="$(docker compose ps -q payroll-worker)"
  if [ -n "$PAYROLL_CONTAINER" ]; then
    PAYROLL_RUNNING="$(docker inspect -f '{{.State.Running}}' "$PAYROLL_CONTAINER" 2>/dev/null || echo false)"
    PAYROLL_HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$PAYROLL_CONTAINER" 2>/dev/null || echo missing)"
    if [ "$PAYROLL_RUNNING" = "true" ] && [ "$PAYROLL_HEALTH" = "healthy" ]; then
      echo "Payroll worker is healthy"
      break
    fi
  else
    PAYROLL_RUNNING=false
    PAYROLL_HEALTH=missing
  fi
  if [ "$PAYROLL_RUNNING" != "true" ]; then
    echo "Payroll worker stopped before becoming healthy. Recent logs:"
    docker compose logs --tail=160 payroll-worker
    restore_previous_backend
    exit 1
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "Payroll worker did not become healthy within five minutes. Recent logs:"
    docker compose logs --tail=200 payroll-worker
    restore_previous_backend
    exit 1
  fi
  echo "Payroll worker not ready yet ($attempt/60; health=$PAYROLL_HEALTH)..."
  sleep 5
done

echo "Health check"
API_HEALTHY=false
for attempt in $(seq 1 180); do
  if curl -fsS http://localhost:8000/api/health; then
    echo
    echo "API is healthy"
    API_HEALTHY=true
    break
  fi
  API_CONTAINER="$(docker compose ps -q api)"
  if [ -z "$API_CONTAINER" ] || [ "$(docker inspect -f '{{.State.Running}}' "$API_CONTAINER" 2>/dev/null || echo false)" != "true" ]; then
    echo "API container stopped before becoming healthy. Recent logs:"
    docker compose logs --tail=160 api
    restore_previous_backend
    exit 1
  fi
  echo "API not ready yet ($attempt/180); schema upgrade or startup is still running..."
  if [ $((attempt % 12)) -eq 0 ]; then
    echo "Recent API startup progress:"
    docker compose logs --tail=20 api
  fi
  sleep 5
done

if [ "$API_HEALTHY" != "true" ]; then
  echo "API did not become healthy within 15 minutes. Recent logs:"
  docker compose logs --tail=200 api
  restore_previous_backend
  exit 1
fi

echo "Restarting lightweight web containers after backend health verification"
FRONTEND_PREVIOUS_AVAILABLE=false
if [ -d "Client App/frontend/build" ]; then
  mv "Client App/frontend/build" "$BACKUP_ROOT/frontend-build"
  FRONTEND_PREVIOUS_AVAILABLE=true
fi
mv "$FRONTEND_STAGING" "Client App/frontend/build"
docker compose up -d --force-recreate frontend nginx

echo "Frontend health check"
for attempt in $(seq 1 30); do
  if curl -fsS http://localhost:3000/ >/dev/null; then
    echo "Frontend is healthy"
    docker compose ps
    exit 0
  fi
  echo "Frontend not ready yet ($attempt/30)..."
  sleep 2
done

echo "Frontend did not become healthy within one minute. Recent logs:"
docker compose logs --tail=120 frontend nginx
if [ "$FRONTEND_PREVIOUS_AVAILABLE" = "true" ] && [ -d "$BACKUP_ROOT/frontend-build" ]; then
  echo "Restoring the previous frontend build"
  mv "Client App/frontend/build" "$BACKUP_ROOT/frontend-build.failed"
  mv "$BACKUP_ROOT/frontend-build" "Client App/frontend/build"
  docker compose up -d --force-recreate frontend nginx
fi
restore_previous_backend
exit 1
