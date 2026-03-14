#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_CONFIG_FILE="${DEPLOY_CONFIG_FILE:-${PROJECT_ROOT}/deploy/server.env.local}"
RUNTIME_CONFIG_FILE="${RUNTIME_CONFIG_FILE:-${PROJECT_ROOT}/deploy/cherry.runtime.env.local}"
SECRETS_CONFIG_FILE="${SECRETS_CONFIG_FILE:-/Users/Eva/.server-sync-secrets.local}"
LOCAL_DATA_DIR="${LOCAL_DATA_DIR:-${PROJECT_ROOT}/data}"

if [[ ! -f "${DEPLOY_CONFIG_FILE}" ]]; then
  echo "Missing deploy config: ${DEPLOY_CONFIG_FILE}"
  exit 1
fi

# shellcheck disable=SC1090
source "${DEPLOY_CONFIG_FILE}"

if [[ -f "${SECRETS_CONFIG_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${SECRETS_CONFIG_FILE}"
fi

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_USER:?DEPLOY_USER is required}"

DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"
REMOTE_BASE_DIR="${REMOTE_BASE_DIR:-/opt/cherry-deploy}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/cherry}"
REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-${REMOTE_BASE_DIR}/shared/data}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-${REMOTE_BASE_DIR}/shared/cherry.env}"

SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
SSH_PASSWORD="${SSH_PASSWORD:-}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REMOTE_SNAPSHOT_DIR="${REMOTE_BASE_DIR}/pull-snapshot-${TIMESTAMP}"
LOCAL_SNAPSHOT_DIR="$(mktemp -d)"
LOCAL_BACKUP_DIR="${PROJECT_ROOT}/output/sync-backups/pull-${TIMESTAMP}"

cleanup() {
  rm -rf "${LOCAL_SNAPSHOT_DIR}"
}

trap cleanup EXIT

ensure_sshpass_if_needed() {
  if [[ -n "${SSH_PASSWORD}" ]] && ! command -v sshpass >/dev/null 2>&1; then
    echo "SSH_PASSWORD is set but sshpass is not installed."
    echo "Install sshpass or switch to SSH key login."
    exit 1
  fi
}

run_ssh() {
  if [[ -n "${SSH_PASSWORD}" ]]; then
    SSHPASS="${SSH_PASSWORD}" sshpass -e ssh -p "${DEPLOY_SSH_PORT}" "$@"
  else
    ssh -p "${DEPLOY_SSH_PORT}" "$@"
  fi
}

run_rsync() {
  if [[ -n "${SSH_PASSWORD}" ]]; then
    SSHPASS="${SSH_PASSWORD}" rsync -e "sshpass -e ssh -p ${DEPLOY_SSH_PORT}" "$@"
  else
    rsync -e "ssh -p ${DEPLOY_SSH_PORT}" "$@"
  fi
}

ensure_local_db_is_idle() {
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  local db_path="${LOCAL_DATA_DIR}/haibao.db"
  local wal_path="${LOCAL_DATA_DIR}/haibao.db-wal"
  local shm_path="${LOCAL_DATA_DIR}/haibao.db-shm"

  if lsof "${db_path}" "${wal_path}" "${shm_path}" >/dev/null 2>&1; then
    echo "Local database appears to be in use. Stop local dev/start processes before pulling server data."
    exit 1
  fi
}

backup_local_file_if_present() {
  local file_path="$1"
  if [[ -f "${file_path}" ]]; then
    mkdir -p "${LOCAL_BACKUP_DIR}"
    cp -p "${file_path}" "${LOCAL_BACKUP_DIR}/"
  fi
}

ensure_local_db_is_idle
ensure_sshpass_if_needed

echo "Creating remote snapshot..."
run_ssh "${SSH_TARGET}" "bash -s" <<EOF
set -euo pipefail
rm -rf '${REMOTE_SNAPSHOT_DIR}'
mkdir -p '${REMOTE_SNAPSHOT_DIR}'
cd '${REMOTE_APP_DIR}'
if [[ -f '${REMOTE_ENV_FILE}' ]]; then
  cp -p '${REMOTE_ENV_FILE}' '${REMOTE_SNAPSHOT_DIR}/cherry.runtime.env'
  set -a
  source '${REMOTE_ENV_FILE}'
  set +a
fi
node scripts/create-data-snapshot.mjs '${REMOTE_SNAPSHOT_DIR}/data'
EOF

echo "Pulling remote snapshot to local temp directory..."
run_rsync -az "${SSH_TARGET}:${REMOTE_SNAPSHOT_DIR}/" "${LOCAL_SNAPSHOT_DIR}/"

mkdir -p "${LOCAL_DATA_DIR}" "${LOCAL_DATA_DIR}/uploads" "${LOCAL_DATA_DIR}/recordings" "${LOCAL_DATA_DIR}/audio-assets"

echo "Backing up local database and runtime config..."
backup_local_file_if_present "${LOCAL_DATA_DIR}/haibao.db"
backup_local_file_if_present "${LOCAL_DATA_DIR}/haibao.db-wal"
backup_local_file_if_present "${LOCAL_DATA_DIR}/haibao.db-shm"
backup_local_file_if_present "${RUNTIME_CONFIG_FILE}"

rm -f "${LOCAL_DATA_DIR}/haibao.db-wal" "${LOCAL_DATA_DIR}/haibao.db-shm"

if [[ -f "${LOCAL_SNAPSHOT_DIR}/cherry.runtime.env" ]]; then
  mkdir -p "$(dirname "${RUNTIME_CONFIG_FILE}")"
  rsync -az "${LOCAL_SNAPSHOT_DIR}/cherry.runtime.env" "${RUNTIME_CONFIG_FILE}"
fi

echo "Updating local database..."
rsync -az "${LOCAL_SNAPSHOT_DIR}/data/haibao.db" "${LOCAL_DATA_DIR}/haibao.db"

echo "Updating local uploads and generated assets incrementally..."
for dir_name in uploads recordings audio-assets; do
  rsync -az --omit-dir-times \
    "${LOCAL_SNAPSHOT_DIR}/data/${dir_name}/" "${LOCAL_DATA_DIR}/${dir_name}/"
done

echo "Cleaning remote snapshot..."
run_ssh "${SSH_TARGET}" "rm -rf '${REMOTE_SNAPSHOT_DIR}'"

echo "Data pull finished."
