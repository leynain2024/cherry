#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_SERVICE="${APP_SERVICE:-cherry}"

cd "${PROJECT_ROOT}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required on the server."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required on the server."
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${current_branch}" == "HEAD" ]]; then
  echo "Detached HEAD detected. Please checkout the deployment branch first."
  exit 1
fi

echo "Updating branch ${current_branch}..."
git pull --ff-only origin "${current_branch}"

echo "Installing dependencies..."
npm ci

echo "Building application..."
npm run build

if command -v systemctl >/dev/null 2>&1; then
  echo "Restarting ${APP_SERVICE}..."
  sudo systemctl restart "${APP_SERVICE}"
  sudo systemctl --no-pager --full status "${APP_SERVICE}" | sed -n '1,12p'
else
  echo "systemctl is unavailable; please restart ${APP_SERVICE} manually."
fi

echo "Server update finished."
