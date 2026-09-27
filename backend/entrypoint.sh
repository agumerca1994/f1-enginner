#!/bin/sh
set -e

# Firebase credentials arrive base64-encoded in an env var (optional until the web app exists).
if [ -n "$FIREBASE_CREDENTIALS_B64" ]; then
  echo "$FIREBASE_CREDENTIALS_B64" | base64 -d > /tmp/firebase-credentials.json
  export FIREBASE_CREDENTIALS_PATH=/tmp/firebase-credentials.json
fi

alembic upgrade head

exec "$@"
