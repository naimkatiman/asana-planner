# 🚀 Quick Start Deployment Guide

Get your Asana Task Planner deployed in production in **under 10 minutes**!

---

## 🎯 Choose Your Deployment Method

### Option 1: Docker (Easiest) ⭐ **RECOMMENDED**

**Perfect for:** Beginners, quick setup, isolated environments

```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sudo sh

# 2. Clone & Deploy
git clone <your-repo-url> /opt/asana-planner
cd /opt/asana-planner
sudo docker-compose up -d

# 3. Done! Check status
sudo docker-compose ps
sudo docker-compose logs -f
```

**Access:** http://your-server-ip:3000

---

### Option 2: PM2 (Most Popular)

**Perfect for:** Traditional server deployment, production apps

```bash
# 1. Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# 2. Install PM2
sudo npm install -g pm2

# 3. Deploy Application
git clone <your-repo-url> /var/www/asana-planner
cd /var/www/asana-planner
npm ci --only=production

# 4. Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# 5. Check status
pm2 status
pm2 logs asana-planner
```

**Access:** http://your-server-ip:3000

---

### Option 3: Systemd (Native Linux)

**Perfect for:** Linux servers, system integration

```bash
# 1. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# 2. Deploy files
sudo mkdir -p /var/www/asana-planner
cd /var/www/asana-planner
sudo git clone <your-repo-url> .
sudo npm ci --only=production

# 3. Install service
sudo cp asana-planner.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable asana-planner
sudo systemctl start asana-planner

# 4. Check status
sudo systemctl status asana-planner
```

**Access:** http://your-server-ip:3000

---

## 🌐 Add Domain & SSL (Optional but Recommended)

### Step 1: Install Nginx

```bash
sudo apt update
sudo apt install nginx -y
```

### Step 2: Configure Reverse Proxy

```bash
# Copy Nginx config
sudo cp nginx.conf /etc/nginx/sites-available/asana-planner

# Edit config with your domain
sudo nano /etc/nginx/sites-available/asana-planner
# Replace 'your-domain.com' with actual domain

# Enable site
sudo ln -s /etc/nginx/sites-available/asana-planner /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 3: Get Free SSL Certificate

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Get certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Done! Your site is now HTTPS
```

**Access:** https://your-domain.com

---

## 🔥 One-Command Deploy

After initial setup, update your app with one command:

```bash
./deploy.sh
```

This script automatically:
- ✅ Pulls latest code
- ✅ Installs dependencies  
- ✅ Restarts application
- ✅ Shows status

---

## ✅ Verify Deployment

```bash
# Test locally
curl http://localhost:3000/api/credentials/status

# Should return:
# {"configured":false,"hasWorkspace":false,"hasProject":false,"hasUser":false}

# Test via domain (if configured)
curl https://your-domain.com/api/credentials/status
```

---

## 📊 Common Commands

### Docker
```bash
sudo docker-compose ps                    # Check status
sudo docker-compose logs -f              # View logs
sudo docker-compose restart              # Restart
sudo docker-compose down && docker-compose up -d  # Full restart
```

### PM2
```bash
pm2 status                               # Check status
pm2 logs asana-planner                  # View logs
pm2 restart asana-planner               # Restart
pm2 monit                               # Monitor resources
```

### Systemd
```bash
sudo systemctl status asana-planner     # Check status
sudo journalctl -u asana-planner -f     # View logs
sudo systemctl restart asana-planner    # Restart
```

---

## 🐛 Troubleshooting

### Port already in use?
```bash
sudo netstat -tulpn | grep :3000
sudo kill <PID>
```

### Can't access from internet?
```bash
# Check firewall
sudo ufw status
sudo ufw allow 3000/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

### Application not starting?
```bash
# Check Node.js version
node --version  # Should be v14+

# Check dependencies
npm ci --only=production

# Check logs
# Docker: sudo docker-compose logs
# PM2: pm2 logs asana-planner
# Systemd: sudo journalctl -u asana-planner -n 50
```

---

## 🔒 Production Checklist

Before going live:

- [ ] ✅ Application running and accessible
- [ ] ✅ Domain pointing to server (if using domain)
- [ ] ✅ SSL certificate installed (for HTTPS)
- [ ] ✅ Firewall configured (ports 80, 443, 22)
- [ ] ✅ Auto-restart configured
- [ ] ✅ Backups scheduled
- [ ] ✅ Monitoring setup
- [ ] ✅ Logs rotating properly

---

## 📚 Need More Help?

- **Full Deployment Guide:** [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Application Docs:** [README.md](./README.md)
- **Project Summary:** [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md)

---

## 🎉 You're Live!

Once deployed, users can:

1. Visit your domain (or http://server-ip:3000)
2. Enter their Asana Personal Access Token
3. Start fetching tasks, planning, and brainstorming!

**Congratulations on your deployment!** 🚀
