#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  CAMS — Azure Australia East Production Deployment
#  City of Kalamunda Crossover Approval Management System
# ═══════════════════════════════════════════════════════════
#
#  Creates:
#    - B2s VM (2 vCPU, 4GB RAM) in Australia East
#    - 32GB OS disk + 32GB data disk (persistent storage)
#    - Static public IP with DNS label (free subdomain)
#    - Let's Encrypt SSL (auto-renew via certbot)
#    - Full CAMS stack via Docker Compose
#
#  Prerequisites:
#    - Azure CLI installed: https://aka.ms/InstallAzureCLIDeb
#    - Logged in: az login
#
#  Usage:
#    chmod +x deploy-azure.sh
#    ./deploy-azure.sh
#
#  Cost: ~$34 AUD/month
# ═══════════════════════════════════════════════════════════

set -e

# ─── Configuration ────────────────────────────────────────
RESOURCE_GROUP="cams-rg"
LOCATION="australiaeast"
VM_NAME="cams-vm"
VM_SIZE="Standard_B2s"
VM_IMAGE="Canonical:ubuntu-24_04-lts:server:latest"
ADMIN_USER="camsadmin"
OS_DISK_SIZE=32
DATA_DISK_SIZE=32
NSG_NAME="cams-nsg"
DNS_LABEL="cams-kalamunda"        # → cams-kalamunda.australiaeast.cloudapp.azure.com
IP_NAME="cams-public-ip"

FQDN="${DNS_LABEL}.${LOCATION}.cloudapp.azure.com"

echo "═══════════════════════════════════════════════════════"
echo "  CAMS Azure Deployment"
echo "  Region: Australia East (Sydney)"
echo "  Domain: ${FQDN}"
echo "═══════════════════════════════════════════════════════"
echo ""

# ─── Step 1: Resource Group ──────────────────────────────
echo "Step 1/7: Creating resource group..."
az group create --name $RESOURCE_GROUP --location $LOCATION --output none
echo "  ✓ $RESOURCE_GROUP in $LOCATION"

# ─── Step 2: Static Public IP with DNS ──────────────────
echo "Step 2/7: Creating static public IP + DNS label..."
az network public-ip create \
  --resource-group $RESOURCE_GROUP \
  --name $IP_NAME \
  --sku Standard \
  --allocation-method Static \
  --dns-name $DNS_LABEL \
  --output none

PUBLIC_IP=$(az network public-ip show --resource-group $RESOURCE_GROUP --name $IP_NAME --query ipAddress -o tsv)
echo "  ✓ Static IP: $PUBLIC_IP"
echo "  ✓ DNS: $FQDN"

# ─── Step 3: Network Security Group ─────────────────────
echo "Step 3/7: Creating firewall rules..."
az network nsg create --resource-group $RESOURCE_GROUP --name $NSG_NAME --output none

for RULE in "AllowSSH:100:22" "AllowHTTP:200:80" "AllowHTTPS:300:443"; do
  IFS=: read NAME PRIO PORT <<< "$RULE"
  az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name $NSG_NAME \
    --name $NAME --priority $PRIO --access Allow --direction Inbound \
    --source-address-prefixes '*' --destination-port-ranges $PORT --protocol Tcp --output none
done
echo "  ✓ Firewall: SSH(22), HTTP(80), HTTPS(443)"

# ─── Step 4: Create VM ──────────────────────────────────
echo "Step 4/7: Creating VM (2-3 minutes)..."
az vm create \
  --resource-group $RESOURCE_GROUP \
  --name $VM_NAME \
  --image $VM_IMAGE \
  --size $VM_SIZE \
  --admin-username $ADMIN_USER \
  --generate-ssh-keys \
  --os-disk-size-gb $OS_DISK_SIZE \
  --data-disk-sizes-gb $DATA_DISK_SIZE \
  --nsg $NSG_NAME \
  --public-ip-address $IP_NAME \
  --output none

echo "  ✓ VM: $VM_NAME ($VM_SIZE)"

# ─── Step 5: Configure Data Disk + Install Docker ───────
echo "Step 5/7: Configuring storage + installing Docker..."

SECRET_KEY=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)

ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 ${ADMIN_USER}@${PUBLIC_IP} << 'SETUPEOF'
set -e

# Format and mount data disk
echo "  → Formatting data disk..."
if [ -b /dev/sdc ] && ! blkid /dev/sdc; then
  sudo mkfs.ext4 /dev/sdc
  sudo mkdir -p /opt/cams-data
  sudo mount /dev/sdc /opt/cams-data
  echo '/dev/sdc /opt/cams-data ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
elif [ -b /dev/disk/azure/scsi1/lun0 ]; then
  DISK=$(readlink -f /dev/disk/azure/scsi1/lun0)
  if ! blkid $DISK; then sudo mkfs.ext4 $DISK; fi
  sudo mkdir -p /opt/cams-data
  sudo mount $DISK /opt/cams-data
  echo "$DISK /opt/cams-data ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab
fi
echo "  ✓ Data disk mounted at /opt/cams-data"

# Create data directories
sudo mkdir -p /opt/cams-data/pgdata
sudo mkdir -p /opt/cams-data/uploads
sudo mkdir -p /opt/cams-data/training_data
sudo mkdir -p /opt/cams-data/backups

# Install Docker
echo "  → Installing Docker..."
sudo apt-get update -qq
sudo apt-get install -y -qq docker.io docker-compose-v2 git certbot > /dev/null 2>&1
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
echo "  ✓ Docker installed"

# Clone CAMS
echo "  → Cloning CAMS..."
sudo git clone https://github.com/arad71/cams.git /opt/cams
cd /opt/cams
sudo git checkout feature/db-rules-refactor
echo "  ✓ Repository cloned"
SETUPEOF

echo "  ✓ Storage + Docker configured"

# ─── Step 6: Configure .env + docker-compose override ───
echo "Step 6/7: Configuring CAMS..."

ssh -o StrictHostKeyChecking=no ${ADMIN_USER}@${PUBLIC_IP} << ENVEOF
# Write .env with real values
sudo tee /opt/cams/.env > /dev/null << EOF
POSTGRES_DB=cams_approval
POSTGRES_USER=cams
POSTGRES_PASSWORD=${DB_PASSWORD}
SECRET_KEY=${SECRET_KEY}
DEBUG=false
CORS_ORIGINS=https://${FQDN},http://${FQDN}
ANTHROPIC_API_KEY=
AI_MODEL_DEFAULT=claude-sonnet-4-20250514
PDF_RENDER_DPI=200
MAX_IMAGE_DIM=2048
AI_MAX_TOKENS=4096
FRONTEND_PORT=80
API_WORKERS=2
ENTRA_ENABLED=false
EOF

# Docker compose override — mount data disk + use port 80
sudo tee /opt/cams/docker-compose.override.yml > /dev/null << EOF
version: "3.9"
services:
  approval-db:
    volumes:
      - /opt/cams-data/pgdata:/var/lib/postgresql/data
  approval-api:
    volumes:
      - /opt/cams-data/uploads:/app/uploads
    environment:
      DOCUMENT_DIR: /app/uploads/documents
  approval-frontend:
    ports:
      - "80:3001"
      - "443:3001"
EOF

echo "  ✓ Environment configured"
ENVEOF

# ─── Step 7: Build + Start + SSL ────────────────────────
echo "Step 7/7: Building containers + SSL certificate..."

ssh -o StrictHostKeyChecking=no ${ADMIN_USER}@${PUBLIC_IP} << STARTEOF
set -e
cd /opt/cams

# Build and start
echo "  → Building containers (3-5 minutes)..."
sudo docker compose -f docker-compose.prod.yml -f docker-compose.override.yml up -d --build

echo "  → Waiting for services..."
sleep 20

# Health check
echo "  → Health check..."
curl -sf http://localhost/api/health && echo " ✓" || echo " ⚠ API starting — may need another minute"

# SSL with Let's Encrypt
echo "  → Requesting SSL certificate..."
sudo docker compose -f docker-compose.prod.yml -f docker-compose.override.yml stop approval-frontend
sudo certbot certonly --standalone --non-interactive --agree-tos \
  --email admin@kalamunda.wa.gov.au \
  -d ${FQDN} || echo "  ⚠ SSL setup failed — will work on HTTP for now"

# Configure nginx for SSL if cert exists
if [ -f /etc/letsencrypt/live/${FQDN}/fullchain.pem ]; then
  # Create SSL nginx config
  sudo mkdir -p /opt/cams/ssl
  sudo tee /opt/cams/ssl/nginx-ssl.conf > /dev/null << NGINXEOF
server {
    listen 80;
    server_name ${FQDN};
    return 301 https://\\\$host\\\$request_uri;
}
server {
    listen 443 ssl http2;
    server_name ${FQDN};
    ssl_certificate /etc/letsencrypt/live/${FQDN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${FQDN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        client_max_body_size 50M;
    }
}
NGINXEOF

  # Install host nginx for SSL termination
  sudo apt-get install -y -qq nginx > /dev/null 2>&1
  sudo cp /opt/cams/ssl/nginx-ssl.conf /etc/nginx/sites-available/cams
  sudo ln -sf /etc/nginx/sites-available/cams /etc/nginx/sites-enabled/cams
  sudo rm -f /etc/nginx/sites-enabled/default

  # Update compose to only listen on localhost
  sudo tee /opt/cams/docker-compose.override.yml > /dev/null << OVEOF
version: "3.9"
services:
  approval-db:
    volumes:
      - /opt/cams-data/pgdata:/var/lib/postgresql/data
  approval-api:
    volumes:
      - /opt/cams-data/uploads:/app/uploads
    environment:
      DOCUMENT_DIR: /app/uploads/documents
  approval-frontend:
    ports:
      - "127.0.0.1:3001:3001"
OVEOF

  sudo nginx -t && sudo systemctl restart nginx
  echo "  ✓ SSL enabled — HTTPS active"

  # Auto-renew cron
  echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'" | sudo tee /etc/cron.d/certbot-renew > /dev/null
  echo "  ✓ SSL auto-renewal configured (daily 3am check)"
fi

# Restart with final config
sudo docker compose -f docker-compose.prod.yml -f docker-compose.override.yml up -d

# Setup daily database backup
echo "0 2 * * * cd /opt/cams && sudo docker compose -f docker-compose.prod.yml exec -T approval-db pg_dump -U cams cams_approval | gzip > /opt/cams-data/backups/cams_\$(date +\%Y\%m\%d).sql.gz && find /opt/cams-data/backups -name '*.sql.gz' -mtime +30 -delete" | sudo tee /etc/cron.d/cams-backup > /dev/null
echo "  ✓ Daily DB backup configured (2am, 30-day retention)"

echo ""
echo "  ✅ CAMS fully deployed!"
STARTEOF

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ CAMS DEPLOYMENT COMPLETE"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  ┌─────────────────────────────────────────────────┐"
echo "  │  Portal:  https://${FQDN}                       "
echo "  │  API:     https://${FQDN}/api/health            "
echo "  │  Docs:    https://${FQDN}/api/docs              "
echo "  └─────────────────────────────────────────────────┘"
echo ""
echo "  ─── Login ──────────────────────────────────────────"
echo "  Email:    m.thompson@kalamunda.wa.gov.au"
echo "  Password: admin123"
echo "  ⚠  CHANGE THIS IMMEDIATELY"
echo ""
echo "  ─── SSH ────────────────────────────────────────────"
echo "  ssh ${ADMIN_USER}@${PUBLIC_IP}"
echo "  ssh ${ADMIN_USER}@${FQDN}"
echo ""
echo "  ─── Storage ────────────────────────────────────────"
echo "  Database:      /opt/cams-data/pgdata     (32GB disk)"
echo "  Documents:     /opt/cams-data/uploads"
echo "  Training data: /opt/cams-data/training_data"
echo "  DB Backups:    /opt/cams-data/backups    (daily, 30-day)"
echo ""
echo "  ─── Enable AI Analysis ─────────────────────────────"
echo "  ssh ${ADMIN_USER}@${FQDN}"
echo "  sudo nano /opt/cams/.env"
echo "  # Set: ANTHROPIC_API_KEY=sk-ant-..."
echo "  cd /opt/cams && sudo docker compose -f docker-compose.prod.yml -f docker-compose.override.yml restart approval-api"
echo ""
echo "  ─── External Services (all outbound HTTPS) ────────"
echo "  ✓ api.anthropic.com        — Claude Vision AI"
echo "  ✓ services.slip.wa.gov.au  — Landgate SLIP (lots)"
echo "  ✓ login.microsoftonline.com — Entra ID SSO"
echo "  ✓ api.open-meteo.com       — Elevation data"
echo "  ✓ overpass-api.de           — OSM features"
echo ""
echo "  ─── Monthly Cost ───────────────────────────────────"
echo "  VM (B2s):       ~\$30 AUD"
echo "  Data disk:      ~\$2 AUD"
echo "  Static IP:      ~\$4 AUD"
echo "  SSL:            Free (Let's Encrypt)"
echo "  Domain:         Free (Azure subdomain)"
echo "  Total:          ~\$36 AUD/month"
echo "═══════════════════════════════════════════════════════"
