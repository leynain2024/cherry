#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${DEPLOY_CONFIG_FILE:-${PROJECT_ROOT}/deploy/server.env.local}"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Missing deploy config: ${CONFIG_FILE}"
  echo "Copy ${PROJECT_ROOT}/deploy/server.env.example to deploy/server.env.local and fill it in first."
  exit 1
fi

# shellcheck disable=SC1090
source "${CONFIG_FILE}"

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_USER:?DEPLOY_USER is required}"

DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"
REMOTE_BASE_DIR="${REMOTE_BASE_DIR:-/srv/cherry}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-${REMOTE_BASE_DIR}/app}"
REMOTE_SHARED_DIR="${REMOTE_SHARED_DIR:-${REMOTE_BASE_DIR}/shared}"
REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-${REMOTE_SHARED_DIR}/data}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-${REMOTE_SHARED_DIR}/cherry.env}"
APP_SERVICE="${APP_SERVICE:-cherry}"

SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
SSH_CMD=(ssh -p "${DEPLOY_SSH_PORT}")
RSYNC_SSH="ssh -p ${DEPLOY_SSH_PORT}"
SNAPSHOT_ROOT="$(mktemp -d)"
SNAPSHOT_DATA_DIR="${SNAPSHOT_ROOT}/data"

cleanup() {
  rm -rf "${SNAPSHOT_ROOT}"
}

trap cleanup EXIT

echo "Creating local data snapshot..."
node "${PROJECT_ROOT}/scripts/create-data-snapshot.mjs" "${SNAPSHOT_DATA_DIR}" >/dev/null

echo "Preparing remote directories and backup..."
"${SSH_CMD[@]}" "${SSH_TARGET}" "bash -s" <<EOF
set -euo pipefail
sudo mkdir -p '${REMOTE_APP_DIR}' '${REMOTE_DATA_DIR}' '${REMOTE_SHARED_DIR}' '${REMOTE_BASE_DIR}/backups'
sudo chown -R "\$USER":"\$(id -gn)" '${REMOTE_BASE_DIR}'

if [[ ! -f '${REMOTE_ENV_FILE}' ]]; then
  cat >'${REMOTE_ENV_FILE}' <<'ENVFILE'
HOST=127.0.0.1
PORT=3135
SERVER_TLS=off
ENVFILE
fi

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q '^${APP_SERVICE}\.service'; then
  sudo systemctl stop '${APP_SERVICE}' || true
fi

if [[ -d '${REMOTE_DATA_DIR}' ]] && find '${REMOTE_DATA_DIR}' -mindepth 1 -maxdepth 1 | read -r _; then
  timestamp=\$(date +%Y%m%d-%H%M%S)
  tar -C '${REMOTE_DATA_DIR}' -czf '${REMOTE_BASE_DIR}/backups/data-\${timestamp}.tar.gz' .
fi
EOF

echo "Syncing application code..."
rsync -az --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'data/' \
  --exclude 'dist/' \
  --exclude 'output/' \
  --exclude '*.local' \
  -e "${RSYNC_SSH}" \
  "${PROJECT_ROOT}/" "${SSH_TARGET}:${REMOTE_APP_DIR}/"

echo "Syncing persistent data..."
rsync -az -e "${RSYNC_SSH}" "${SNAPSHOT_DATA_DIR}/haibao.db" "${SSH_TARGET}:${REMOTE_DATA_DIR}/haibao.db"
for dir_name in uploads recordings audio-assets; do
  rsync -az --delete -e "${RSYNC_SSH}" \
    "${SNAPSHOT_DATA_DIR}/${dir_name}/" "${SSH_TARGET}:${REMOTE_DATA_DIR}/${dir_name}/"
done

echo "Installing service file, building and restarting..."
"${SSH_CMD[@]}" "${SSH_TARGET}" "bash -s" <<EOF
set -euo pipefail
cd '${REMOTE_APP_DIR}'
npm ci
npm run build
sudo cp '${REMOTE_APP_DIR}/deploy/systemd/cherry.service' '/etc/systemd/system/${APP_SERVICE}.service'
sudo systemctl daemon-reload
sudo systemctl enable '${APP_SERVICE}'
sudo systemctl restart '${APP_SERVICE}'
sudo systemctl --no-pager --full status '${APP_SERVICE}' | sed -n '1,12p'
EOF

echo "Deploy finished."
