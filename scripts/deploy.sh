#!/usr/bin/env bash
# Deploy test bot (develop branch) at /root/telbot-test
set -euo pipefail

APP_DIR="/root/telbot-test"
PM2_NAME="telbot-test"
BRANCH="develop"

echo "==> Deploying $BRANCH to $APP_DIR"

cd "$APP_DIR"

if [ -f scripts/backup-db.js ]; then
  node scripts/backup-db.js || echo "Warning: pre-deploy backup failed"
fi

git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

npm install

if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    pm2 restart "$PM2_NAME"
  else
    pm2 start index.js --name "$PM2_NAME"
  fi
  pm2 save
else
  echo "PM2 not installed. Run: npm install -g pm2"
  exit 1
fi

echo "==> Done: test bot deployed"
