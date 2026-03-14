#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_CONFIG_FILE="${DEPLOY_CONFIG_FILE:-${PROJECT_ROOT}/deploy/server.env.local}"
RUNTIME_CONFIG_FILE="${RUNTIME_CONFIG_FILE:-${PROJECT_ROOT}/deploy/cherry.runtime.env.local}"
SECRETS_CONFIG_FILE="${SECRETS_CONFIG_FILE:-/Users/Eva/.server-sync-secrets.local}"

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
REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-${REMOTE_BASE_DIR}/shared/data}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-${REMOTE_BASE_DIR}/shared/cherry.env}"
APP_SERVICE="${APP_SERVICE:-cherry}"
REMOTE_SERVICE_FILE="${REMOTE_SERVICE_FILE:-/etc/systemd/system/${APP_SERVICE}.service}"

SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
SSH_PASSWORD="${SSH_PASSWORD:-}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
SNAPSHOT_ROOT="$(mktemp -d)"
SNAPSHOT_DATA_DIR="${SNAPSHOT_ROOT}/data"
REMOTE_SUDO_PASSWORD="${REMOTE_SUDO_PASSWORD:-}"

cleanup() {
  rm -rf "${SNAPSHOT_ROOT}"
}

trap cleanup EXIT

shell_escape_for_single_quotes() {
  printf "%s" "$1" | sed "s/'/'\\\\''/g"
}

ensure_sshpass_if_needed() {
  if [[ -n "${SSH_PASSWORD}" ]] && ! command -v sshpass >/dev/null 2>&1; then
    echo "SSH_PASSWORD is set but sshpass is not installed."
    echo "Install sshpass or switch to SSH key login."
    exit 1
  fi
}

ensure_remote_sudo_password() {
  if [[ -n "${REMOTE_SUDO_PASSWORD}" ]]; then
    return
  fi

  read -rsp "Remote sudo password for ${DEPLOY_USER}@${DEPLOY_HOST}: " REMOTE_SUDO_PASSWORD
  echo
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

echo "Creating local data snapshot..."
node "${PROJECT_ROOT}/scripts/create-data-snapshot.mjs" "${SNAPSHOT_DATA_DIR}" >/dev/null

ensure_sshpass_if_needed
ensure_remote_sudo_password
ESCAPED_REMOTE_SUDO_PASSWORD="$(shell_escape_for_single_quotes "${REMOTE_SUDO_PASSWORD}")"

echo "Preparing remote data directories and backups..."
run_ssh "${SSH_TARGET}" "bash -s" <<EOF
set -euo pipefail
REMOTE_SUDO_PASSWORD='${ESCAPED_REMOTE_SUDO_PASSWORD}'
run_sudo() {
  printf '%s\n' "\${REMOTE_SUDO_PASSWORD}" | sudo -S -p '' "\$@"
}

mkdir -p '${REMOTE_DATA_DIR}' '${REMOTE_DATA_DIR}/uploads' '${REMOTE_DATA_DIR}/recordings' '${REMOTE_DATA_DIR}/audio-assets'
run_sudo mkdir -p '${REMOTE_BASE_DIR}/sync-backups'

backup_dir='${REMOTE_BASE_DIR}/sync-backups/push-${TIMESTAMP}'
backup_needed=0
for item in '${REMOTE_DATA_DIR}/haibao.db' '${REMOTE_DATA_DIR}/haibao.db-wal' '${REMOTE_DATA_DIR}/haibao.db-shm' '${REMOTE_ENV_FILE}'; do
  if [[ -f "\${item}" ]]; then
    backup_needed=1
    break
  fi
done

if [[ "\${backup_needed}" == '1' ]]; then
  mkdir -p "\${backup_dir}"
  for item in '${REMOTE_DATA_DIR}/haibao.db' '${REMOTE_DATA_DIR}/haibao.db-wal' '${REMOTE_DATA_DIR}/haibao.db-shm' '${REMOTE_ENV_FILE}'; do
    if [[ -f "\${item}" ]]; then
      cp -p "\${item}" "\${backup_dir}/"
    fi
  done
fi

service_exists=0
if [[ -f '${REMOTE_SERVICE_FILE}' ]]; then
  service_exists=1
elif command -v systemctl >/dev/null 2>&1 && systemctl cat '${APP_SERVICE}' >/dev/null 2>&1; then
  service_exists=1
fi

if [[ "\${service_exists}" == '1' ]]; then
  run_sudo systemctl stop '${APP_SERVICE}' || true
fi

rm -f '${REMOTE_DATA_DIR}/haibao.db-wal' '${REMOTE_DATA_DIR}/haibao.db-shm'
EOF

if [[ -f "${RUNTIME_CONFIG_FILE}" ]]; then
  echo "Syncing runtime config..."
  run_rsync -az "${RUNTIME_CONFIG_FILE}" "${SSH_TARGET}:${REMOTE_ENV_FILE}"
else
  echo "Runtime config not found, skipping: ${RUNTIME_CONFIG_FILE}"
fi

echo "Syncing database snapshot..."
run_rsync -az "${SNAPSHOT_DATA_DIR}/haibao.db" "${SSH_TARGET}:${REMOTE_DATA_DIR}/haibao.db"

echo "Syncing uploads and generated assets incrementally..."
for dir_name in uploads recordings audio-assets; do
  run_rsync -az --omit-dir-times \
    "${SNAPSHOT_DATA_DIR}/${dir_name}/" "${SSH_TARGET}:${REMOTE_DATA_DIR}/${dir_name}/"
done

echo "Restarting remote service..."
run_ssh "${SSH_TARGET}" "bash -s" <<EOF
set -euo pipefail
REMOTE_SUDO_PASSWORD='${ESCAPED_REMOTE_SUDO_PASSWORD}'
run_sudo() {
  printf '%s\n' "\${REMOTE_SUDO_PASSWORD}" | sudo -S -p '' "\$@"
}

service_exists=0
if [[ -f '${REMOTE_SERVICE_FILE}' ]]; then
  service_exists=1
elif command -v systemctl >/dev/null 2>&1 && systemctl cat '${APP_SERVICE}' >/dev/null 2>&1; then
  service_exists=1
fi

if [[ "\${service_exists}" == '1' ]]; then
  run_sudo systemctl restart '${APP_SERVICE}'
  run_sudo systemctl --no-pager --full status '${APP_SERVICE}' | sed -n '1,12p'
else
  echo "Service ${APP_SERVICE} is not installed yet; database and files were synced."
fi
EOF

echo "Data push finished."
