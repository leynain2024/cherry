#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVER_NAME="${SERVER_NAME:-haibao.ballofleyna.cn}"
APP_UPSTREAM="${APP_UPSTREAM:-127.0.0.1:3135}"
TEMPLATE_FILE="${PROJECT_ROOT}/deploy/nginx/haibao.site.conf.template"
TARGET_FILE="/etc/nginx/sites-available/${SERVER_NAME}.conf"
LINK_FILE="/etc/nginx/sites-enabled/${SERVER_NAME}.conf"

if [[ ! -f "${TEMPLATE_FILE}" ]]; then
  echo "Template not found: ${TEMPLATE_FILE}"
  exit 1
fi

TMP_FILE="$(mktemp)"
trap 'rm -f "${TMP_FILE}"' EXIT

sed \
  -e "s/__SERVER_NAME__/${SERVER_NAME}/g" \
  -e "s/__APP_UPSTREAM__/${APP_UPSTREAM}/g" \
  "${TEMPLATE_FILE}" >"${TMP_FILE}"

sudo cp "${TMP_FILE}" "${TARGET_FILE}"
sudo ln -sfn "${TARGET_FILE}" "${LINK_FILE}"
sudo nginx -t
sudo systemctl reload nginx

echo "Nginx site installed: ${TARGET_FILE}"
