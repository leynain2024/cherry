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

SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
SSH_CMD=(ssh -p "${DEPLOY_SSH_PORT}")
RSYNC_SSH="ssh -p ${DEPLOY_SSH_PORT}"
REMOTE_SNAPSHOT_DIR="${REMOTE_BASE_DIR}/pull-snapshot"
LOCAL_DATA_DIR="${PROJECT_ROOT}/data"

echo "Creating remote data snapshot..."
"${SSH_CMD[@]}" "${SSH_TARGET}" "bash -s" <<EOF
set -euo pipefail
rm -rf '${REMOTE_SNAPSHOT_DIR}'
mkdir -p '${REMOTE_SNAPSHOT_DIR}'
cd '${REMOTE_APP_DIR}'
node scripts/create-data-snapshot.mjs '${REMOTE_SNAPSHOT_DIR}'
EOF

echo "Pulling data back to local workspace..."
mkdir -p "${LOCAL_DATA_DIR}"
rsync -az -e "${RSYNC_SSH}" "${SSH_TARGET}:${REMOTE_SNAPSHOT_DIR}/haibao.db" "${LOCAL_DATA_DIR}/haibao.db"
for dir_name in uploads recordings audio-assets; do
  mkdir -p "${LOCAL_DATA_DIR}/${dir_name}"
  rsync -az --delete -e "${RSYNC_SSH}" \
    "${SSH_TARGET}:${REMOTE_SNAPSHOT_DIR}/${dir_name}/" "${LOCAL_DATA_DIR}/${dir_name}/"
done

echo "Cleaning remote snapshot..."
"${SSH_CMD[@]}" "${SSH_TARGET}" "rm -rf '${REMOTE_SNAPSHOT_DIR}'"

echo "Pull finished."
