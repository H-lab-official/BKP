# วิธี Setup Nginx สำหรับ bkp.devza.autos

## ขั้นตอนที่ 1: ติดตั้ง Nginx

```bash
sudo apt update
sudo apt install nginx -y
sudo systemctl enable nginx
sudo systemctl start nginx
```

---

## ขั้นตอนที่ 2: คัดลอก Config

```bash
# SSH เข้า VPS แล้วไปที่โฟลเดอร์โปรเจกต์
cd ~/seat-collab

# คัดลอก config ไปยัง nginx
sudo cp nginx/bkp.devza.autos.conf /etc/nginx/sites-available/
```

---

## ขั้นตอนที่ 3: เปิดใช้งาน Site

```bash
# สร้าง symlink เพื่อ enable site
sudo ln -sf /etc/nginx/sites-available/bkp.devza.autos.conf /etc/nginx/sites-enabled/

# ลบ default site (ถ้าไม่ต้องการ)
sudo rm -f /etc/nginx/sites-enabled/default
```

---

## ขั้นตอนที่ 4: ทดสอบและโหลด Config

```bash
# ทดสอบว่า config ถูกต้อง
sudo nginx -t

# ถ้า OK จะแสดง: syntax is ok, test is successful
# โหลด nginx ใหม่
sudo systemctl reload nginx
```

---

## ขั้นตอนที่ 5: ตั้งค่า DNS

ชี้ domain `bkp.devza.autos` ไปที่ IP ของ VPS:

| Type | Name | Value |
|------|------|-------|
| A | bkp | YOUR_VPS_IP |

หรือถ้าใช้ subdomain แบบอื่น ให้เพิ่ม A record ตาม DNS provider

---

## ขั้นตอนที่ 6: ติดตั้ง SSL (HTTPS)

```bash
# ติดตั้ง certbot
sudo apt install certbot python3-certbot-nginx -y

# ขอ SSL certificate (ต้องชี้ DNS มาที่ VPS ก่อน)
sudo certbot --nginx -d bkp.devza.autos
```

Certbot จะแก้ไข nginx config ให้ใช้ HTTPS อัตโนมัติ

---

## คำสั่งที่ใช้บ่อย

```bash
# ดูสถานะ nginx
sudo systemctl status nginx

# Restart nginx
sudo systemctl restart nginx

# Reload config (ไม่หยุดการทำงาน)
sudo systemctl reload nginx

# ดู error log
sudo tail -f /var/log/nginx/error.log

# ดู access log
sudo tail -f /var/log/nginx/access.log

# ทดสอบ config ก่อน reload
sudo nginx -t
```

---

## ตรวจสอบว่า App รันอยู่

Nginx จะ proxy ไปที่ `http://127.0.0.1:5173` ดังนั้นต้องให้ seat-collab รันด้วย PM2:

```bash
pm2 status
# ต้องเห็น seat-collab อยู่ในสถานะ online
```
