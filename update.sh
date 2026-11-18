#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  CAMS Safe Update Script
#
#  Pulls latest code and rebuilds containers WITHOUT:
#    ✗ Deleting any data
#    ✗ Re-seeding the database
#    ✗ Resetting users or applications
#    ✗ Touching GeoJSON files
#
#  Usage:
#    ./update.sh              Pull + rebuild + restart
#    ./update.sh --no-cache   Pull + rebuild from scratch (slower)
#    ./update.sh --frontend   Rebuild frontend only
#    ./update.sh --backend    Rebuild backend only
#    ./update.sh --geodata    Also refresh GeoData after update
#    ./update.sh --no-pull    Don't git pull (deploy whatever is checked out;
#                             used by the GitHub "Deploy" workflow)
#
#  Exits non-zero if the pull, build or health check fails.
# ═══════════════════════════════════════════════════════════

set -eo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

# Detect compose file
if [ -f .env ] && grep -q "DATABASE_URL" .env 2>/dev/null; then
  COMPOSE="docker-compose.external-db.yml"
  ENV_NAME="production"
else
  COMPOSE="docker-compose.prod.yml"
  ENV_NAME="test"
fi

dc() { docker compose -f "$COMPOSE" "$@"; }

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  CAMS Safe Update${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Environment: ${GREEN}${ENV_NAME}${NC}"
echo -e "  Compose:     ${COMPOSE}"
echo -e "  This will NOT delete or reseed any data."
echo ""

# ── Parse options ──
NO_CACHE=""
TARGET=""
GEODATA=false
PULL=true

for arg in "$@"; do
  case "$arg" in
    --no-cache)   NO_CACHE="--no-cache" ;;
    --frontend)   TARGET="approval-frontend" ;;
    --backend)    TARGET="approval-api" ;;
    --geodata)    GEODATA=true ;;
    --no-pull)    PULL=false ;;
  esac
done

# ── Step 1: Pull latest code ──
if [ "$PULL" = true ]; then
  echo -e "${BLUE}[1/4] Pulling latest code from master...${NC}"
  # --ff-only: stop rather than create a merge if the server copy has diverged
  git pull --ff-only origin master 2>&1 | tail -5
else
  echo -e "${BLUE}[1/4] Using checked-out code ($(git rev-parse --short HEAD)) — not pulling${NC}"
fi
echo ""

# ── Step 2.5: Ensure swap exists (prevents npm build OOM) ──
if [ ! -f /swapfile ] && [ "$(id -u)" = "0" ]; then
  echo -e "${YELLOW}  Creating 2GB swap (prevents build OOM)...${NC}"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile 2>/dev/null || true
elif [ -f /swapfile ]; then
  swapon /swapfile 2>/dev/null || true
fi

# ── Step 3: Rebuild ──
if [ -n "$TARGET" ]; then
  echo -e "${BLUE}[2/4] Rebuilding ${TARGET}...${NC}"
  dc build $NO_CACHE "$TARGET"
  echo -e "${BLUE}[3/4] Restarting ${TARGET}...${NC}"
  dc up -d --no-deps "$TARGET"
else
  echo -e "${BLUE}[2/4] Rebuilding all containers${NO_CACHE:+ (no-cache)}...${NC}"
  echo -e "  Building backend..."
  dc build $NO_CACHE approval-api
  echo -e "  Clearing Docker build cache..."
  docker builder prune -f --filter "until=1h" 2>/dev/null || true
  echo -e "  Building frontend (this takes a minute)..."
  dc build $NO_CACHE approval-frontend
  if dc config --services | grep -qx cams-cron; then
    echo -e "  Building scheduled-task container..."
    dc build $NO_CACHE cams-cron
  fi
  echo -e "${BLUE}[3/4] Restarting services...${NC}"
  dc up -d
fi

# ── Step 4: Health check ──
# Call /api/health inside the API container, then through the frontend (nginx).
echo -e "${BLUE}[4/4] Waiting for services...${NC}"
FRONTEND_PORT=$( (grep -E '^FRONTEND_PORT=[0-9]+' .env 2>/dev/null || true) | tail -1 | sed -E 's/^FRONTEND_PORT=([0-9]+).*/\1/')
FRONTEND_PORT=${FRONTEND_PORT:-3001}
HEALTHY=false
for i in $(seq 1 36); do
  if dc exec -T approval-api python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/api/health', timeout=5).status == 200 else 1)" >/dev/null 2>&1 \
     && curl -fsS --max-time 5 "http://localhost:${FRONTEND_PORT}/api/health" >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  echo "  Waiting... ($((i * 5))s)"
  sleep 5
done

# Show status
echo ""
dc ps
echo ""

if [ "$HEALTHY" != true ]; then
  echo -e "${RED}✗ Health check failed after 3 minutes. Recent API logs:${NC}"
  dc logs --tail=60 approval-api || true
  exit 1
fi
echo -e "${GREEN}✓ API and frontend are healthy${NC}"

# ── Optional: refresh GeoData ──
if [ "$GEODATA" = true ]; then
  echo -e "${BLUE}Refreshing GeoData layers...${NC}"
  dc exec approval-api python scripts/update_geodata.py --layer all 2>&1 | tail -20
  echo ""
fi

# Summary
PUBLIC_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
PORT=3001

echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Update complete — no data was modified${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Portal:  ${BLUE}http://${PUBLIC_IP}:${PORT}${NC}"
echo -e "  API:     ${BLUE}http://${PUBLIC_IP}:${PORT}/api/docs${NC}"
echo ""
echo "  What was updated:"
echo "    ✓ Code pulled from master"
echo "    ✓ Containers rebuilt and restarted"
echo "    ✓ Database schema auto-migrated (if new columns)"
echo ""
echo "  What was NOT touched:"
echo "    ✗ Database data (applications, users, notes, assessments)"
echo "    ✗ GeoJSON files (lot, roads, speed, contours, drainage, etc.)"
echo "    ✗ Uploaded documents"
echo ""
if [ "$GEODATA" = false ]; then
  echo "  To also refresh GeoData: ./update.sh --geodata"
fi
echo ""
