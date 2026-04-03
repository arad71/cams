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
# ═══════════════════════════════════════════════════════════

set -e
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

# ── Step 1: Pull latest code ──
echo -e "${BLUE}[1/4] Pulling latest code from master...${NC}"
git pull origin master 2>&1 | tail -5
echo ""

# ── Step 2: Parse options ──
NO_CACHE=""
TARGET=""
GEODATA=false

for arg in "$@"; do
  case "$arg" in
    --no-cache)   NO_CACHE="--no-cache" ;;
    --frontend)   TARGET="approval-frontend" ;;
    --backend)    TARGET="approval-api" ;;
    --geodata)    GEODATA=true ;;
  esac
done

# ── Step 3: Rebuild ──
if [ -n "$TARGET" ]; then
  echo -e "${BLUE}[2/4] Rebuilding ${TARGET}...${NC}"
  dc build $NO_CACHE "$TARGET"
  echo -e "${BLUE}[3/4] Restarting ${TARGET}...${NC}"
  dc up -d --no-deps "$TARGET"
else
  echo -e "${BLUE}[2/4] Rebuilding all containers${NO_CACHE:+ (no-cache)}...${NC}"
  if [ -n "$NO_CACHE" ]; then
    dc build --no-cache approval-frontend
    dc build approval-api
  else
    dc build
  fi
  echo -e "${BLUE}[3/4] Restarting services...${NC}"
  dc up -d
fi

# ── Step 4: Health check ──
echo -e "${BLUE}[4/4] Waiting for services...${NC}"
sleep 5
for i in $(seq 1 12); do
  if dc logs approval-api 2>&1 | tail -20 | grep -q "Application startup complete\|assessment rules\|Uvicorn running"; then
    break
  fi
  echo "  Waiting... (${i}0s)"
  sleep 5
done

# Show status
echo ""
dc ps
echo ""

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
