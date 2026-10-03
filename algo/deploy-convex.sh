#!/usr/bin/env bash
# Deploy the PlateFix Convex backend (schema, auth, households) in one shot.
#
# Prereqs:
#   - npm i   (so the `convex` CLI and @convex-dev/auth are available)
#   - VITE_CONVEX_URL (or CONVEX_URL) set to your Convex deployment URL,
#     e.g. https://<deployment>.convex.cloud
#
# This script is for the standalone/Vercel deploy path. The Freebuff preview
# host manages the Convex backend itself; you only need this when deploying
# PlateFix to your own Vercel project.
set -euo pipefail

CONVEX_URL="${VITE_CONVEX_URL:-${CONVEX_URL:-}}"

if [ -z "$CONVEX_URL" ]; then
  echo "ERROR: Set VITE_CONVEX_URL (or CONVEX_URL) to your Convex URL before running this script."
  echo "  export VITE_CONVEX_URL=https://<your-deployment>.convex.cloud"
  exit 1
fi

echo "==> Deploying Convex backend to: $CONVEX_URL"
# `npx convex` will read convex.json (functions: src/convex/) and deploy
# schema + http/auth routes + households query/mutation to the target deployment.
npx convex dev --once \
  --url "$CONVEX_URL" \
  --types \
  --yes
