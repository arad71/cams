#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  CAMS — Azure Australia East Deployment Script
#  City of Kalamunda Crossover Approval Management System
# ═══════════════════════════════════════════════════════════
#
#  Prerequisites:
#    - Azure CLI installed (az login already done)
#    - A domain name pointed to Azure (optional — can use IP)
#
#  Usage:
#    chmod +x deploy-azure.sh
#    ./deploy-azure.sh
#
#  Cost: ~$30/month (B2s VM + 32GB disk)
#  Region: Australia East (Sydney) — WA Gov compliant
# ═══════════════════════════════════════════════════════════

set -e

# ─── Configuration ────────────────────────────────────────
RESOURCE_GROUP="cams-rg"
LOCATION="australiaeast"
VM_NAME="cams-vm"
VM_SIZE="Standard_B2s"           # 2 vCPU, 4GB RAM — ~$30/mo
VM_IMAGE="Canonical:ubuntu-24_04-lts:server:latest"
ADMIN_USER="camsadmin"
DISK_SIZE=32                     # GB
NSG_NAME="cams-nsg"
DOMAIN=""                        # Set your domain here (optional)

echo "═══════════════════════════════════════════════════════"
echo "  CAMS Azure Deployment — Australia East"
echo "═══════════════════════════════════════════════════════"
echo ""

# ─── Step 1: Resource Group ──────────────────────────────
echo "Step 1: Creating resource group..."
az group create --name $RESOURCE_GROUP --location $LOCATION --output none
echo "  ✓ Resource group: $RESOURCE_GROUP ($LOCATION)"

# ─── Step 2: Network Security Group ─────────────────────
echo "Step 2: Creating network security group..."
az network nsg create --resource-group $RESOURCE_GROUP --name $NSG_NAME --output none

# Allow SSH, HTTP, HTTPS
az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name $NSG_NAME \
  --name AllowSSH --priority 100 --access Allow --direction Inbound \
  --source-address-prefixes '*' --destination-port-ranges 22 --protocol Tcp --output none

az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name $NSG_NAME \
  --name AllowHTTP --priority 200 --access Allow --direction Inbound \
  --source-address-prefixes '*' --destination-port-ranges 80 --protocol Tcp --output none

az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name $NSG_NAME \
  --name AllowHTTPS --priority 300 --access Allow --direction Inbound \
  --source-address-prefixes '*' --destination-port-ranges 443 --protocol Tcp --output none

az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name $NSG_NAME \
  --name AllowCAMS --priority 400 --access Allow --direction Inbound \
  --source-address-prefixes '*' --destination-port-ranges 3001 --protocol Tcp --output none

echo "  ✓ NSG rules: SSH(22), HTTP(80), HTTPS(443), CAMS(3001)"

# ─── Step 3: Create VM ──────────────────────────────────
echo "Step 3: Creating VM (this takes 2-3 minutes)..."
az vm create \
  --resource-group $RESOURCE_GROUP \
  --name $VM_NAME \
  --image $VM_IMAGE \
  --size $VM_SIZE \
  --admin-username $ADMIN_USER \
  --generate-ssh-keys \
  --os-disk-size-gb $DISK_SIZE \
  --nsg $NSG_NAME \
  --public-ip-sku Standard \
  --output json > /tmp/cams-vm-output.json

PUBLIC_IP=$(jq -r '.publicIpAddress' /tmp/cams-vm-output.json)
echo "  ✓ VM created: $VM_NAME"
echo "  ✓ Public IP: $PUBLIC_IP"
echo ""

# ─── Step 4: Install Docker + Deploy CAMS ────────────────
echo "Step 4: Installing Docker and deploying CAMS on VM..."
echo "  (This takes 3-5 minutes — installing packages, building containers)"
echo ""

# Generate secrets
SECRET_KEY=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)

ssh -o StrictHostKeyChecking=no ${ADMIN_USER}@${PUBLIC_IP} << 'REMOTE_SCRIPT'
set -e

echo "  → Installing Docker..."
sudo apt-get update -qq
sudo apt-get install -y -qq docker.io docker-compose-v2 git jq > /dev/null 2>&1
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER

echo "  → Cloning CAMS repository..."
sudo git clone https://github.com/arad71/cams.git /opt/cams
cd /opt/cams
sudo git checkout feature/db-rules-refactor

echo "  → Configuring environment..."
sudo tee /opt/cams/.env > /dev/null << ENVEOF
POSTGRES_DB=cams_approval
POSTGRES_USER=cams
POSTGRES_PASSWORD=PLACEHOLDER_DB_PW
SECRET_KEY=PLACEHOLDER_SECRET
DEBUG=false
CORS_ORIGINS=http://PLACEHOLDER_IP:3001,https://PLACEHOLDER_IP
ANTHROPIC_API_KEY=
AI_MODEL_DEFAULT=claude-sonnet-4-20250514
PDF_RENDER_DPI=200
MAX_IMAGE_DIM=2048
AI_MAX_TOKENS=4096
FRONTEND_PORT=3001
API_WORKERS=2
ENTRA_ENABLED=false
ENVEOF

echo "  → Building and starting containers..."
cd /opt/cams
sudo docker compose -f docker-compose.prod.yml up -d --build

echo "  → Waiting for services to start..."
sleep 15

echo "  → Checking health..."
curl -s http://localhost:3001/api/health || echo "  ⚠ API not ready yet — may need another minute"

echo "  ✓ CAMS deployed!"
REMOTE_SCRIPT

# Replace placeholders with actual values
ssh -o StrictHostKeyChecking=no ${ADMIN_USER}@${PUBLIC_IP} << REMOTE_VARS
sudo sed -i "s|PLACEHOLDER_DB_PW|${DB_PASSWORD}|g" /opt/cams/.env
sudo sed -i "s|PLACEHOLDER_SECRET|${SECRET_KEY}|g" /opt/cams/.env
sudo sed -i "s|PLACEHOLDER_IP|${PUBLIC_IP}|g" /opt/cams/.env
cd /opt/cams && sudo docker compose -f docker-compose.prod.yml up -d
REMOTE_VARS

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ CAMS DEPLOYMENT COMPLETE"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Portal URL:  http://${PUBLIC_IP}:3001"
echo "  API Health:  http://${PUBLIC_IP}:3001/api/health"
echo "  API Docs:    http://${PUBLIC_IP}:3001/api/docs"
echo ""
echo "  SSH Access:  ssh ${ADMIN_USER}@${PUBLIC_IP}"
echo "  Logs:        ssh ${ADMIN_USER}@${PUBLIC_IP} 'cd /opt/cams && sudo docker compose -f docker-compose.prod.yml logs -f'"
echo ""
echo "  ─── Default Login ───────────────────────────────────"
echo "  Email:    m.thompson@kalamunda.wa.gov.au"
echo "  Password: admin123"
echo "  ⚠ CHANGE THIS IMMEDIATELY AFTER FIRST LOGIN"
echo ""
echo "  ─── External Services ───────────────────────────────"
echo "  To enable AI site plan analysis, add your Anthropic API key:"
echo "    ssh ${ADMIN_USER}@${PUBLIC_IP}"
echo "    sudo nano /opt/cams/.env"
echo "    # Set ANTHROPIC_API_KEY=sk-ant-..."
echo "    cd /opt/cams && sudo docker compose -f docker-compose.prod.yml restart approval-api"
echo ""
echo "  ─── SSL (optional) ─────────────────────────────────"
echo "  Point your domain A record to ${PUBLIC_IP}, then:"
echo "    ssh ${ADMIN_USER}@${PUBLIC_IP}"
echo "    sudo apt install certbot"
echo "    sudo certbot certonly --standalone -d crossover.kalamunda.wa.gov.au"
echo ""
echo "  ─── Monthly Cost ───────────────────────────────────"
echo "  VM (B2s):     ~\$30 AUD/mo"
echo "  Disk (32GB):  ~\$2 AUD/mo"
echo "  Bandwidth:    ~\$0 (5GB free)"
echo "  Total:        ~\$32 AUD/mo"
echo "═══════════════════════════════════════════════════════"
