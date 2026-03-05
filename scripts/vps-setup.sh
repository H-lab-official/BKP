#!/bin/bash
# ============================================================
# VPS Ubuntu - First-time setup script for seat-collab
# รันบน VPS ครั้งแรกก่อนใช้ GitHub Actions deploy
# ============================================================

set -e

echo ">>> Installing Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo ">>> Installing PM2 globally..."
sudo npm install -g pm2

echo ">>> Installing PostgreSQL (ถ้ายังไม่มี)..."
sudo apt-get update
sudo apt-get install -y postgresql postgresql-contrib || true

echo ">>> Cloning repo (ถ้ายังไม่มี)..."
APP_DIR="${HOME}/seat-collab"
if [ ! -d "$APP_DIR" ]; then
  git clone https://github.com/YOUR_ORG/seat-collab.git "$APP_DIR"  # แก้ YOUR_ORG เป็น username/org จริง
  cd "$APP_DIR"
else
  cd "$APP_DIR"
  git pull origin main || true
fi

echo ">>> Creating .env from template..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠️ แก้ไข .env ให้ถูกต้อง: nano .env"
fi

echo ">>> Installing dependencies..."
npm ci --omit=dev

echo ">>> Starting with PM2..."
pm2 start server.js --name seat-collab
pm2 save
pm2 startup  # แสดงคำสั่งให้รันเพื่อ auto-start ตอน reboot

echo ""
echo ">>> Setup เสร็จแล้ว!"
echo ">>> อย่าลืม:"
echo "    1. แก้ไข .env (PG_*, PORT, API_BASE_URL)"
echo "    2. สร้าง PostgreSQL database: createdb seat_collab"
echo "    3. เพิ่ม SSH public key ใน GitHub Secrets (VPS_SSH_KEY)"
echo ""
