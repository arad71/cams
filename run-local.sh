#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  CAMS Local Development (no Docker)
#
#  Prerequisites:
#    - PostgreSQL running locally on port 5432
#    - Database 'cams_approval' created
#    - Python 3.11+ with venv
#    - Node.js 18+
#
#  Usage:
#    ./run-local.sh setup     First time: create DB, venv, install deps, seed
#    ./run-local.sh start     Start backend + frontend (2 terminals)
#    ./run-local.sh backend   Start backend only (uvicorn with hot reload)
#    ./run-local.sh frontend  Start frontend only (vite dev server)
#    ./run-local.sh seed      Re-seed database (clears all data)
#    ./run-local.sh dbcreate  Create the PostgreSQL database
# ═══════════════════════════════════════════════════════════

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

# Load .env.test if no .env exists (local dev uses test config)
if [ ! -f .env ] && [ -f .env.test ]; then
  echo -e "${YELLOW}No .env found — copying .env.test → .env${NC}"
  cp .env.test .env
  # For local dev, override DB to use localhost (not Docker container)
  if ! grep -q "DATABASE_URL" .env; then
    echo "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cams_approval" >> .env
  fi
fi

# Source .env file if it exists
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Fallback defaults for local dev
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/cams_approval}"
export SECRET_KEY="${SECRET_KEY:-local-dev-secret-key-not-for-production}"
export CORS_ORIGINS="${CORS_ORIGINS:-*}"
export DEBUG="${DEBUG:-true}"

case "${1:-help}" in

  setup)
    echo -e "${BLUE}═══ CAMS Local Setup ═══${NC}"

    # Create database
    echo -e "${BLUE}1. Creating database...${NC}"
    createdb cams_approval 2>/dev/null && echo -e "${GREEN}   ✓ Database created${NC}" || echo -e "${YELLOW}   ⏭ Database already exists${NC}"

    # Python venv + deps
    echo -e "${BLUE}2. Setting up Python environment...${NC}"
    cd approval-backend
    if [ ! -d .venv ]; then
      python3 -m venv .venv
      echo -e "${GREEN}   ✓ Virtual environment created${NC}"
    fi
    source .venv/bin/activate
    pip install -r requirements.txt -q
    echo -e "${GREEN}   ✓ Python dependencies installed${NC}"
    cd ..

    # Node deps
    echo -e "${BLUE}3. Installing frontend dependencies...${NC}"
    cd approval-frontend
    npm install --silent
    echo -e "${GREEN}   ✓ Node dependencies installed${NC}"
    cd ..

    # Seed
    echo -e "${BLUE}4. Seeding database...${NC}"
    cd approval-backend
    source .venv/bin/activate
    python -c "from app.seed import run_seed; run_seed()"
    cd ..

    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✅ Setup complete!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo ""
    echo "  Run:  ./run-local.sh start"
    echo ""
    echo "  Test Accounts:"
    echo "    admin@council.wa.gov.au     / admin123"
    echo "    manager@council.wa.gov.au   / manager123"
    echo "    engineer@council.wa.gov.au  / engineer123"
    echo "    viewer@council.wa.gov.au    / viewer123"
    echo ""
    ;;

  backend)
    echo -e "${BLUE}Starting backend (uvicorn)...${NC}"
    cd approval-backend
    if [ -d .venv ]; then
      source .venv/bin/activate
    fi
    echo -e "${GREEN}  API:  http://localhost:8000${NC}"
    echo -e "${GREEN}  Docs: http://localhost:8000/docs${NC}"
    echo ""
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    ;;

  frontend)
    echo -e "${BLUE}Starting frontend (vite)...${NC}"
    cd approval-frontend
    echo -e "${GREEN}  Portal: http://localhost:5173${NC}"
    echo ""
    npx vite --host 0.0.0.0
    ;;

  start)
    echo -e "${BLUE}═══ Starting CAMS Local Dev ═══${NC}"
    echo ""
    echo -e "  Backend:  ${GREEN}http://localhost:8000${NC}  (API + docs)"
    echo -e "  Frontend: ${GREEN}http://localhost:5173${NC}  (Portal)"
    echo ""
    echo -e "${YELLOW}Starting backend in background...${NC}"

    # Start backend in background
    cd "$SCRIPT_DIR/approval-backend"
    if [ -d .venv ]; then
      source .venv/bin/activate
    fi
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
    BACKEND_PID=$!
    cd "$SCRIPT_DIR"

    # Give backend a moment to start
    sleep 2

    echo -e "${YELLOW}Starting frontend...${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop both${NC}"
    echo ""

    # Start frontend in foreground
    trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID 2>/dev/null; exit 0" INT TERM
    cd approval-frontend
    npx vite --host 0.0.0.0

    # If frontend exits, stop backend too
    kill $BACKEND_PID 2>/dev/null
    ;;

  seed)
    echo -e "${BLUE}Re-seeding database (clears all data)...${NC}"
    cd approval-backend
    if [ -d .venv ]; then
      source .venv/bin/activate
    fi
    python -c "
from app.core.database import SessionLocal
from app.models.assessment import AssessmentRule, AssessmentItem, AssessmentCategory, CaseAssessment
from app.models.application import Application, ApplicationNote, Document, Inspection, Report
from app.models.ai_training import AITrainingSample, AITrainingCorrection
from app.models.sight_distance import SightDistance
db = SessionLocal()
db.query(AITrainingCorrection).delete()
db.query(AITrainingSample).delete()
db.query(CaseAssessment).delete()
db.query(SightDistance).delete()
db.query(Report).delete()
db.query(Inspection).delete()
db.query(ApplicationNote).delete()
db.query(Document).delete()
db.query(Application).delete()
db.query(AssessmentRule).delete()
db.query(AssessmentItem).delete()
db.query(AssessmentCategory).delete()
db.commit()
db.close()
print('Cleared all data')
from app.seed import run_seed
run_seed()
"
    echo -e "${GREEN}✓ Database re-seeded${NC}"
    ;;

  dbcreate)
    echo -e "${BLUE}Creating PostgreSQL database...${NC}"
    createdb cams_approval 2>/dev/null && echo -e "${GREEN}✓ cams_approval created${NC}" || echo -e "${YELLOW}⏭ Already exists${NC}"
    ;;

  help|*)
    echo ""
    echo "CAMS Local Development"
    echo "══════════════════════"
    echo ""
    echo "  ./run-local.sh setup     First time setup (DB, venv, deps, seed)"
    echo "  ./run-local.sh start     Start backend + frontend together"
    echo "  ./run-local.sh backend   Start backend only (uvicorn :8000)"
    echo "  ./run-local.sh frontend  Start frontend only (vite :5173)"
    echo "  ./run-local.sh seed      Re-seed database (clears all data)"
    echo "  ./run-local.sh dbcreate  Create PostgreSQL database"
    echo ""
    echo "Prerequisites:"
    echo "  PostgreSQL running on localhost:5432"
    echo "  Python 3.11+, Node.js 18+"
    echo ""
    echo "Override database: export DATABASE_URL=postgresql://user:pass@host:5432/dbname"
    echo ""
    ;;
esac
