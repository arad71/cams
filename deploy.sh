#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  CAMS Deploy Script
#
#  Usage:
#    ./deploy.sh test        Deploy test environment
#    ./deploy.sh prod        Deploy production environment
#    ./deploy.sh stop        Stop all services
#    ./deploy.sh logs        View logs
#    ./deploy.sh reset       Reset database (WARNING: deletes data)
#    ./deploy.sh update      Pull latest code and rebuild
#    ./deploy.sh status      Show service status
#    ./deploy.sh backup      Backup database
# ═══════════════════════════════════════════════════════════

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

# Detect which compose file is active
detect_env() {
  if [ -f .env ]; then
    if grep -q "DATABASE_URL" .env 2>/dev/null; then
      echo "production"
    else
      echo "test"
    fi
  else
    echo "none"
  fi
}

compose_file() {
  local env=$(detect_env)
  if [ "$env" = "production" ]; then
    echo "docker-compose.external-db.yml"
  else
    echo "docker-compose.prod.yml"
  fi
}

dc() {
  docker compose -f "$(compose_file)" "$@"
}

case "${1:-help}" in

  test)
    echo -e "${BLUE}═══ Deploying TEST environment ═══${NC}"
    
    if [ ! -f .env ] || ! grep -q "POSTGRES_DB" .env 2>/dev/null; then
      echo -e "${YELLOW}Creating .env from .env.test...${NC}"
      cp .env.test .env
      # Generate random secrets
      SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
      DBPASS=$(python3 -c "import secrets; print(secrets.token_hex(16))")
      sed -i "s/SECRET_KEY=CHANGE_ME.*/SECRET_KEY=$SECRET/" .env
      sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$DBPASS/" .env
      echo -e "${GREEN}✓ .env created with random secrets${NC}"
      echo -e "${YELLOW}  Edit .env to add ANTHROPIC_API_KEY (optional)${NC}"
    else
      echo -e "${GREEN}✓ Using existing .env${NC}"
    fi

    # Create swap on low-RAM VMs
    TOTAL_MEM=$(free -m 2>/dev/null | awk '/Mem:/{print $2}' || echo 8000)
    if [ "$TOTAL_MEM" -lt 3500 ] && [ ! -f /swapfile ]; then
      echo -e "${YELLOW}Creating 2GB swap for build...${NC}"
      sudo fallocate -l 2G /swapfile 2>/dev/null && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
      echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
    fi

    echo -e "${BLUE}Building and starting (3-5 min first time)...${NC}"
    docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -3
    
    sleep 10
    for i in $(seq 1 12); do
      if docker compose -f docker-compose.prod.yml logs approval-api 2>&1 | grep -q "assessment rules"; then break; fi
      echo "  Waiting for seed... (${i}0s)"
      sleep 5
    done

    PUBLIC_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✅ TEST environment running${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  Portal:  ${BLUE}http://${PUBLIC_IP}:3001${NC}"
    echo -e "  API:     ${BLUE}http://${PUBLIC_IP}:3001/api/docs${NC}"
    echo ""
    echo "  Logins:"
    echo "    admin@council.wa.gov.au     / admin123"
    echo "    manager@council.wa.gov.au   / manager123"
    echo "    engineer@council.wa.gov.au  / engineer123"
    echo "    viewer@council.wa.gov.au    / viewer123"
    echo ""
    ;;

  prod|production)
    echo -e "${BLUE}═══ Deploying PRODUCTION environment ═══${NC}"
    
    if [ ! -f .env ] || ! grep -q "DATABASE_URL" .env 2>/dev/null; then
      echo -e "${YELLOW}Creating .env from .env.production...${NC}"
      cp .env.production .env
      SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
      sed -i "s/SECRET_KEY=CHANGE_ME.*/SECRET_KEY=$SECRET/" .env
      echo ""
      echo -e "${RED}  ⚠  REQUIRED: Edit .env before proceeding:${NC}"
      echo "     nano .env"
      echo ""
      echo "  Set these values:"
      echo "    DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require"
      echo "    ANTHROPIC_API_KEY=sk-ant-..."
      echo "    ENTRA_TENANT_ID=..."
      echo "    ENTRA_CLIENT_ID=..."
      echo "    ENTRA_CLIENT_SECRET=..."
      echo ""
      echo "  Then run: ./deploy.sh prod"
      exit 0
    fi

    # Validate required fields
    if grep -q "CHANGE_ME" .env; then
      echo -e "${RED}  ✗ .env still has CHANGE_ME values. Edit it first:${NC}"
      grep "CHANGE_ME" .env | head -5
      exit 1
    fi

    echo -e "${BLUE}Building and starting production...${NC}"
    docker compose -f docker-compose.external-db.yml up -d --build 2>&1 | tail -3
    
    sleep 10
    for i in $(seq 1 12); do
      if docker compose -f docker-compose.external-db.yml logs approval-api 2>&1 | grep -q "assessment rules"; then break; fi
      echo "  Waiting for seed... (${i}0s)"
      sleep 5
    done

    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✅ PRODUCTION environment running${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo ""
    docker compose -f docker-compose.external-db.yml ps
    ;;

  stop)
    echo -e "${YELLOW}Stopping services...${NC}"
    dc down
    echo -e "${GREEN}✓ Stopped${NC}"
    ;;

  logs)
    dc logs -f ${2:-}
    ;;

  status)
    echo -e "${BLUE}═══ Service Status ═══${NC}"
    echo -e "Environment: ${GREEN}$(detect_env)${NC}"
    echo -e "Compose:     $(compose_file)"
    echo ""
    dc ps
    ;;

  reset)
    echo -e "${RED}⚠  WARNING: This will DELETE ALL DATA${NC}"
    read -p "Type 'yes' to confirm: " confirm
    if [ "$confirm" = "yes" ]; then
      dc down -v
      echo -e "${YELLOW}Rebuilding with fresh database...${NC}"
      dc up -d --build
      echo -e "${GREEN}✓ Database reset. Seed data re-created.${NC}"
    else
      echo "Cancelled."
    fi
    ;;

  update)
    echo -e "${BLUE}Pulling latest code...${NC}"
    git pull origin master
    echo -e "${BLUE}Rebuilding containers...${NC}"
    dc up -d --build
    echo -e "${GREEN}✓ Updated and running${NC}"
    ;;

  backup)
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="cams_backup_${TIMESTAMP}.sql"
    ENV=$(detect_env)
    
    if [ "$ENV" = "production" ]; then
      DB_URL=$(grep DATABASE_URL .env | cut -d= -f2-)
      echo -e "${BLUE}Backing up production database...${NC}"
      pg_dump "$DB_URL" > "$BACKUP_FILE"
    else
      echo -e "${BLUE}Backing up Docker database...${NC}"
      docker compose -f docker-compose.prod.yml exec -T approval-db \
        pg_dump -U cams cams_approval > "$BACKUP_FILE"
    fi
    
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✓ Backup saved: ${BACKUP_FILE} (${SIZE})${NC}"
    ;;

  reseed)
    echo -e "${BLUE}Re-seeding: clearing ALL applications and rules...${NC}"
    dc exec approval-api python -c "
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
print('Cleared all applications, assessments, and rules')
from app.seed import run_seed
run_seed()
"
    echo -e "${GREEN}✓ Full reseed complete (rules + sample apps re-created)${NC}"
    ;;

  help|*)
    echo ""
    echo "CAMS Deploy Script"
    echo "══════════════════"
    echo ""
    echo "  ./deploy.sh test         Deploy test (Docker DB, port 3001)"
    echo "  ./deploy.sh prod         Deploy production (external DB)"
    echo "  ./deploy.sh stop         Stop all services"
    echo "  ./deploy.sh status       Show service status"
    echo "  ./deploy.sh logs         View all logs (or: logs approval-api)"
    echo "  ./deploy.sh update       Pull latest code + rebuild"
    echo "  ./deploy.sh backup       Backup database to SQL file"
    echo "  ./deploy.sh reset        Reset database (WARNING: deletes data)"
    echo "  ./deploy.sh reseed       Re-seed assessment rules only"
    echo ""
    echo "Environments:"
    echo "  test  → docker-compose.prod.yml      (DB in Docker, ~\$50/mo)"
    echo "  prod  → docker-compose.external-db.yml (Azure Postgres, ~\$80/mo)"
    echo ""
    ;;
esac
