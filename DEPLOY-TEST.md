# CAMS — Test Deployment Guide (Azure VM + Docker DB)

Quick test environment — everything runs in Docker on a single VM.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Azure VM (B2s — 2 vCPU, 4GB RAM)                   │
│                                                      │
│  ┌─────────────────┐  ┌──────────────────┐           │
│  │ approval-frontend│  │   approval-db    │           │
│  │ (nginx + react) │  │ (PostgreSQL 16)  │           │
│  │ port 3001       │  │ Docker container │           │
│  └────────┬────────┘  └────────┬─────────┘           │
│           │ /api proxy         │                     │
│  ┌────────┴────────────────────┴──┐                  │
│  │         approval-api           │                  │
│  │         (FastAPI + uvicorn)    │                  │
│  └────────────────────────────────┘                  │
└──────────────────────────────────────────────────────┘
```

Cost: ~$50 AUD/mo (VM only, DB in Docker)

---

## Step 1 — Create Azure VM

### Azure Portal

1. Search "Virtual machines" → Create
2. Fill in:

| Setting | Value |
|---------|-------|
| Resource group | `cams-test-rg` (create new) |
| VM name | `cams-test-vm` |
| Region | `Australia Southeast` |
| Image | `Ubuntu Server 24.04 LTS` |
| Size | `Standard_B2s` (2 vCPU, 4GB) |
| Authentication | SSH key or password |
| Username | `azureuser` |

### Or CLI

```bash
az group create --name cams-test-rg --location australiasoutheast

az vm create \
  --resource-group cams-test-rg \
  --name cams-test-vm \
  --image Ubuntu2404 \
  --size Standard_B2s \
  --admin-username azureuser \
  --generate-ssh-keys
```

---

## Step 2 — Open Port 3001

**Portal**: VM → Networking → Add inbound rule → Port 3001

**CLI**:
```bash
az vm open-port --resource-group cams-test-rg --name cams-test-vm --port 3001
```

---

## Step 3 — SSH and Deploy (one command)

```bash
# Get your VM IP
az vm show -d --resource-group cams-test-rg --name cams-test-vm --query publicIps -o tsv

# SSH in
ssh azureuser@<VM-IP>

# Run setup (installs Docker, clones repo, builds, seeds)
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/arad71/cams/master/setup-azure.sh)"
```

Takes about 5 minutes. When done:

```
═══════════════════════════════════════════════════
  ✅ TEST environment running
═══════════════════════════════════════════════════

  Portal:  http://<VM-IP>:3001
  API:     http://<VM-IP>:3001/api/docs

  Logins:
    admin@council.wa.gov.au     / admin123
    manager@council.wa.gov.au   / manager123
    engineer@council.wa.gov.au  / engineer123
    viewer@council.wa.gov.au    / viewer123
```

---

## Step 4 — Optional: Add AI Key

```bash
cd /opt/cams
sudo nano .env
# Set: ANTHROPIC_API_KEY=sk-ant-your-key-here
sudo ./deploy.sh test
```

---

## Management

```bash
cd /opt/cams
./deploy.sh status     # What's running
./deploy.sh logs       # View logs
./deploy.sh update     # Pull latest + rebuild
./deploy.sh reseed     # Clear all data + reseed
./deploy.sh stop       # Stop
./deploy.sh test       # Start
```

---

## Cost Control

```bash
# Pause VM (~$5/mo for disk only)
az vm deallocate --resource-group cams-test-rg --name cams-test-vm

# Resume
az vm start --resource-group cams-test-rg --name cams-test-vm

# Destroy everything
az group delete --name cams-test-rg --yes --no-wait
```
