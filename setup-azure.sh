#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  CAMS Azure/Cloud Setup Script
#  
#  Usage (after SSH into VM):
#    sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/arad71/cams/master/setup-azure.sh)"
#
#  Or download and run:
#    curl -fsSL https://raw.githubusercontent.com/arad71/cams/master/setup-azure.sh -o setup.sh
#    chmod +x setup.sh
#    sudo bash setup.sh
# ═══════════════════════════════════════════════════════════

set -e

# Must run as root or with sudo
if [ "$EUID" -ne 0 ]; then
  echo "Please run with sudo:  sudo bash setup-azure.sh"
  exit 1
fi

INSTALL_DIR="/opt/cams"
REPO_URL="https://github.com/arad71/cams.git"
BRANCH="master"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  CAMS — City Approval Management System Setup"
echo "═══════════════════════════════════════════════════"
echo ""

# ─── Step 1: System updates + Docker ─────────────────
echo "═══ Step 1/5: Installing Docker ═══"
apt-get update -qq
apt-get install -y -qq git curl python3 > /dev/null 2>&1

if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  echo "  ✓ Docker installed"
else
  echo "  ✓ Docker already installed"
fi

# Ensure docker compose plugin is available
if ! docker compose version &> /dev/null; then
  apt-get install -y -qq docker-compose-plugin > /dev/null 2>&1
  echo "  ✓ Docker Compose plugin installed"
else
  echo "  ✓ Docker Compose already available"
fi

# ─── Step 2: Clone repository ────────────────────────
echo ""
echo "═══ Step 2/5: Cloning Repository ═══"
if [ -d "$INSTALL_DIR" ]; then
  echo "  Directory $INSTALL_DIR exists — pulling latest..."
  cd "$INSTALL_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  git checkout "$BRANCH"
fi
echo "  ✓ Code ready at $INSTALL_DIR"

# ─── Step 3: Create .env ────────────────────────────
echo ""
echo "═══ Step 3/5: Creating Configuration ═══"
cd "$INSTALL_DIR"

if [ -f .env ]; then
  echo "  .env already exists — keeping existing config"
else
  SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  DBPASS=$(python3 -c "import secrets; print(secrets.token_hex(16))")

  cat > .env << ENVEOF
# Database
POSTGRES_DB=cams_approval
POSTGRES_USER=cams
POSTGRES_PASSWORD=${DBPASS}

# Backend
SECRET_KEY=${SECRET}
CORS_ORIGINS=*
API_WORKERS=2

# AI — add your Anthropic key for site plan analysis (optional)
ANTHROPIC_API_KEY=
AI_MODEL_DEFAULT=claude-sonnet-4-20250514
PDF_RENDER_DPI=200
MAX_IMAGE_DIM=2048
AI_MAX_TOKENS=4096

# Frontend
FRONTEND_PORT=3001

# SSO (disabled for testing)
ENTRA_ENABLED=false
ENVEOF

  echo "  ✓ .env created with secure random passwords"
  echo ""
  echo "  ⚠  To enable AI site plan analysis, edit:"
  echo "     nano $INSTALL_DIR/.env"
  echo "     Set ANTHROPIC_API_KEY=sk-ant-your-key-here"
  echo ""
fi

# ─── Step 4: Deploy test environment ────────────────
echo "═══ Step 4/5: Deploying ═══"
cd "$INSTALL_DIR"
chmod +x deploy.sh
bash deploy.sh test
