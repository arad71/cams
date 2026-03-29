#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  CAMS Azure Setup Script
#  Run this AFTER SSH into the VM:
#    ssh azureuser@<your-ip>
#    curl -fsSL https://raw.githubusercontent.com/arad71/cams/feature/db-rules-refactor/setup-azure.sh | bash
#  OR copy-paste the whole script into the terminal
# ═══════════════════════════════════════════════════════════

set -e

echo "═══ CAMS Setup — Step 1/5: Installing Docker ═══"
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

echo "═══ CAMS Setup — Step 2/5: Cloning Repository ═══"
cd ~
git clone https://github.com/arad71/cams.git
cd cams
git checkout feature/db-rules-refactor

echo "═══ CAMS Setup — Step 3/5: Creating .env ═══"
SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
cat > .env << EOF
# Database
POSTGRES_DB=cams_approval
POSTGRES_USER=cams
POSTGRES_PASSWORD=CamsAzure2026!Strong

# Backend
SECRET_KEY=$SECRET
CORS_ORIGINS=*
API_WORKERS=2

# AI (replace with your key for site plan analysis)
ANTHROPIC_API_KEY=
AI_MODEL_DEFAULT=claude-sonnet-4-20250514
PDF_RENDER_DPI=200
MAX_IMAGE_DIM=2048
AI_MAX_TOKENS=4096

# Frontend
FRONTEND_PORT=3001

# SSO (disabled for testing)
ENTRA_ENABLED=false
EOF

echo ""
echo "  ⚠  Edit .env to add your ANTHROPIC_API_KEY (optional):"
echo "     nano ~/cams/.env"
echo ""

echo "═══ CAMS Setup — Step 4/5: Building Containers ═══"
echo "  This takes 3-5 minutes..."
sudo docker compose -f docker-compose.prod.yml up -d --build

echo "═══ CAMS Setup — Step 5/5: Waiting for Database Seed ═══"
echo "  Waiting for services to start..."
sleep 10

# Wait for the API to be healthy (max 60 seconds)
for i in $(seq 1 12); do
  if sudo docker compose -f docker-compose.prod.yml logs approval-api 2>&1 | grep -q "assessment rules"; then
    echo "  ✅ Database seeded successfully!"
    break
  fi
  echo "  Waiting... ($((i*5))s)"
  sleep 5
done

# Get the public IP
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "<your-ip>")

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ CAMS is running!"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  Approval Portal:  http://$PUBLIC_IP:3001"
echo "  API Docs:         http://$PUBLIC_IP:3001/api/docs"
echo ""
echo "  Test Logins:"
echo "    Admin:     m.thompson@kalamunda.wa.gov.au  /  admin123"
echo "    Manager:   k.williams@kalamunda.wa.gov.au  /  manager123"
echo "    Engineer:  s.patel@kalamunda.wa.gov.au     /  engineer123"
echo ""
echo "  Commands:"
echo "    View logs:    cd ~/cams && sudo docker compose -f docker-compose.prod.yml logs -f"
echo "    Restart:      cd ~/cams && sudo docker compose -f docker-compose.prod.yml restart"
echo "    Stop:         cd ~/cams && sudo docker compose -f docker-compose.prod.yml down"
echo ""
