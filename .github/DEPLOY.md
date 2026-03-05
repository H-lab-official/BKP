# Deploy seat-collab ไป VPS Ubuntu

## 1. เตรียม VPS (ครั้งแรก)

### บน VPS Ubuntu

```bash
# Clone repo และรัน setup
curl -sSL https://raw.githubusercontent.com/YOUR_ORG/seat-collab/main/scripts/vps-setup.sh | bash

# หรือ clone แล้วรันเอง
git clone https://github.com/YOUR_ORG/seat-collab.git ~/seat-collab
cd ~/seat-collab
chmod +x scripts/vps-setup.sh
./scripts/vps-setup.sh
```

### สร้าง PostgreSQL database

```bash
sudo -u postgres psql -c "CREATE DATABASE seat_collab;"
sudo -u postgres psql -c "CREATE USER your_user WITH PASSWORD 'your_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE seat_collab TO your_user;"
```

### แก้ไข .env

```bash
nano ~/seat-collab/.env
# ใส่ PG_HOST, PG_PASSWORD, API_BASE_URL ให้ถูกต้อง
```

### สร้าง SSH key สำหรับ GitHub Actions

```bash
# บนเครื่องของคุณ (ไม่ใช่ VPS)
ssh-keygen -t ed25519 -C "github-actions-deploy" -f deploy_key -N ""

# คัดลอก public key ไปใส่ใน VPS
ssh-copy-id -i deploy_key.pub user@your-vps-ip

# ใส่ private key ใน GitHub Secrets (ดูด้านล่าง)
cat deploy_key
```

---

## 2. ตั้งค่า GitHub Secrets

ไปที่ **Repository → Settings → Secrets and variables → Actions** แล้วเพิ่ม:

| Secret | คำอธิบาย |
|--------|----------|
| `VPS_HOST` | IP หรือ hostname ของ VPS |
| `VPS_USER` | SSH username (เช่น ubuntu, root) |
| `VPS_SSH_KEY` | เนื้อหา private key ทั้งหมด |
| `VPS_SSH_PORT` | (optional) พอร์ต SSH ค่าเริ่มต้น 22 |
| `VPS_APP_PATH` | (optional) path โฟลเดอร์ app เช่น `/home/ubuntu/seat-collab` |
| `ENV_FILE` | เนื้อหา .env ทั้งหมด |

### สร้าง ENV_FILE

**วิธีที่ 1 (แนะนำ):** คัดลอกเนื้อหาไฟล์ `.env` ทั้งหมดไปวางใน GitHub Secret `ENV_FILE`

**วิธีที่ 2 (base64):** ถ้าต้องการ encode ก่อน
```bash
# Linux
base64 -w0 .env
# Mac
base64 -i .env | tr -d '\n'
```

---

## 3. การ Deploy

- **อัตโนมัติ**: push ไปที่ branch `main` จะ deploy ทันที
- **Manual**: ไปที่ **Actions → Deploy to VPS (Ubuntu) → Run workflow**

---

## 4. Setup Nginx (ถ้าใช้ domain)

ดูคู่มือละเอียดที่ [nginx/NGINX_SETUP.md](../nginx/NGINX_SETUP.md)

---

## 5. คำสั่งบน VPS (หลัง deploy)

```bash
# ดู log
pm2 logs seat-collab

# Restart manual
pm2 restart seat-collab

# ดูสถานะ
pm2 status
```
