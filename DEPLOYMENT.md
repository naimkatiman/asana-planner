# 🚀 Asana Task Planner - Deployment Guide

Complete guide for deploying the Asana Task Planner to production servers.

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Deployment Method 1: Docker (Recommended)](#method-1-docker-recommended)
3. [Deployment Method 2: Traditional Server (PM2)](#method-2-traditional-server-pm2)
4. [Deployment Method 3: Systemd Service](#method-3-systemd-service)
5. [Nginx Reverse Proxy Setup](#nginx-reverse-proxy-setup)
6. [SSL Certificate Setup](#ssl-certificate-setup)
7. [Environment Variables](#environment-variables)
8. [Monitoring & Maintenance](#monitoring--maintenance)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software
- **Node.js**: v14+ (v20 recommended)
- **npm**: v6+
- **Git**: For cloning repository

### Optional (depending on method)
- **Docker & Docker Compose**: For containerized deployment
- **PM2**: For process management
- **Nginx**: For reverse proxy
- **Certbot**: For SSL certificates

### Server Requirements
- **OS**: Ubuntu 20.04+ / Debian 10+ / CentOS 8+ / RHEL 8+
- **RAM**: Minimum 512MB (1GB+ recommended)
- **CPU**: 1 core minimum
- **Storage**: 1GB minimum
- **Network**: Port 80 and 443 open for HTTPS

---

## Method 1: Docker (Recommended)

### Why Docker?
✅ Isolated environment  
✅ Easy deployment and rollback  
✅ Consistent across environments  
✅ Built-in health checks  

### Step 1: Install Docker

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### Step 2: Deploy Application

```bash
# Clone or upload your application
cd /opt
sudo git clone <your-repo-url> asana-planner
cd asana-planner

# Build and start
sudo docker-compose up -d

# Check status
sudo docker-compose ps
sudo docker-compose logs -f
```

### Step 3: Manage Container

```bash
# Stop application
sudo docker-compose down

# Restart application
sudo docker-compose restart

# View logs
sudo docker-compose logs -f asana-planner

# Update application
git pull
sudo docker-compose build --no-cache
sudo docker-compose up -d

# Check health
sudo docker ps
```

---

## Method 2: Traditional Server (PM2)

### Why PM2?
✅ Process management  
✅ Auto-restart on crashes  
✅ Load balancing (cluster mode)  
✅ Built-in monitoring  

### Step 1: Prepare Server

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version
```

### Step 2: Deploy Application

```bash
# Create application directory
sudo mkdir -p /var/www/asana-planner
sudo chown $USER:$USER /var/www/asana-planner

# Upload or clone application
cd /var/www/asana-planner
git clone <your-repo-url> .

# Install dependencies
npm ci --only=production

# Install PM2 globally
sudo npm install -g pm2

# Create logs directory
mkdir -p logs
```

### Step 3: Start with PM2

```bash
# Start application using ecosystem file
pm2 start ecosystem.config.js

# Or start with custom config
pm2 start server.js --name asana-planner -i 2 --env production

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup
# Run the command output by the above

# Check status
pm2 status
pm2 logs asana-planner
pm2 monit
```

### Step 4: PM2 Management

```bash
# Restart application
pm2 restart asana-planner

# Stop application
pm2 stop asana-planner

# Delete application
pm2 delete asana-planner

# View logs
pm2 logs asana-planner --lines 100

# Monitor resources
pm2 monit

# List all processes
pm2 list
```

---

## Method 3: Systemd Service

### Why Systemd?
✅ Native Linux service  
✅ Automatic start on boot  
✅ System integration  
✅ Logging via journald  

### Step 1: Install Application

```bash
# Install Node.js (same as Method 2)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Deploy application
sudo mkdir -p /var/www/asana-planner
cd /var/www/asana-planner
sudo git clone <your-repo-url> .
sudo npm ci --only=production

# Set permissions
sudo chown -R www-data:www-data /var/www/asana-planner
```

### Step 2: Install Systemd Service

```bash
# Copy service file
sudo cp asana-planner.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable service (start on boot)
sudo systemctl enable asana-planner

# Start service
sudo systemctl start asana-planner

# Check status
sudo systemctl status asana-planner
```

### Step 3: Manage Service

```bash
# Start service
sudo systemctl start asana-planner

# Stop service
sudo systemctl stop asana-planner

# Restart service
sudo systemctl restart asana-planner

# View logs
sudo journalctl -u asana-planner -f

# View recent logs
sudo journalctl -u asana-planner -n 100

# Check if enabled
sudo systemctl is-enabled asana-planner
```

---

## Nginx Reverse Proxy Setup

### Why Nginx?
✅ SSL/TLS termination  
✅ Load balancing  
✅ Static file caching  
✅ Security headers  

### Step 1: Install Nginx

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx -y

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### Step 2: Configure Site

```bash
# Copy Nginx configuration
sudo cp nginx.conf /etc/nginx/sites-available/asana-planner

# Update domain name in config
sudo nano /etc/nginx/sites-available/asana-planner
# Replace 'your-domain.com' with your actual domain

# Enable site
sudo ln -s /etc/nginx/sites-available/asana-planner /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### Step 3: Firewall Configuration

```bash
# UFW (Ubuntu)
sudo ufw allow 'Nginx Full'
sudo ufw allow 22/tcp
sudo ufw enable

# Or use iptables
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```

---

## SSL Certificate Setup

### Option 1: Let's Encrypt (Free SSL)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Test auto-renewal
sudo certbot renew --dry-run

# Certificates auto-renew, but you can force renewal:
sudo certbot renew
```

### Option 2: Custom SSL Certificate

```bash
# If you have your own SSL certificate:
sudo mkdir -p /etc/ssl/asana-planner

# Copy your certificate files
sudo cp your-cert.crt /etc/ssl/asana-planner/certificate.crt
sudo cp your-key.key /etc/ssl/asana-planner/private.key

# Update Nginx config to point to your certificates
sudo nano /etc/nginx/sites-available/asana-planner
# Update ssl_certificate and ssl_certificate_key paths

# Reload Nginx
sudo systemctl reload nginx
```

---

## Environment Variables

### Production Environment Setup

```bash
# Create .env file (optional, for sensitive data)
cat > /var/www/asana-planner/.env << 'EOF'
NODE_ENV=production
PORT=3000
# Add other environment variables as needed
EOF

# Set permissions
chmod 600 /var/www/asana-planner/.env
```

### Update server.js to use environment variables (if needed)

```javascript
require('dotenv').config(); // Add at top of server.js

const PORT = process.env.PORT || 3000;
```

---

## Monitoring & Maintenance

### Health Checks

```bash
# Check application status
curl http://localhost:3000/api/credentials/status

# Check with domain
curl https://your-domain.com/api/credentials/status

# Monitor logs in real-time
# Docker:
sudo docker-compose logs -f

# PM2:
pm2 logs asana-planner

# Systemd:
sudo journalctl -u asana-planner -f
```

### Performance Monitoring

```bash
# PM2 monitoring
pm2 monit

# System resources
htop
df -h
free -h

# Network connections
sudo netstat -tulpn | grep :3000
```

### Backup Strategy

```bash
# Backup application
sudo tar -czf asana-planner-backup-$(date +%Y%m%d).tar.gz /var/www/asana-planner

# Backup to remote server
scp asana-planner-backup-*.tar.gz user@backup-server:/backups/
```

### Updates & Maintenance

```bash
# For Docker
cd /opt/asana-planner
git pull
sudo docker-compose build --no-cache
sudo docker-compose up -d

# For PM2
cd /var/www/asana-planner
git pull
npm ci --only=production
pm2 restart asana-planner

# For Systemd
cd /var/www/asana-planner
sudo git pull
sudo npm ci --only=production
sudo systemctl restart asana-planner
```

---

## Troubleshooting

### Application won't start

```bash
# Check logs
# Docker:
sudo docker-compose logs

# PM2:
pm2 logs asana-planner --err

# Systemd:
sudo journalctl -u asana-planner -n 50

# Common issues:
# 1. Port already in use
sudo netstat -tulpn | grep :3000
sudo kill <PID>

# 2. Missing dependencies
npm ci --only=production

# 3. Permission issues
sudo chown -R www-data:www-data /var/www/asana-planner
```

### Cannot access via domain

```bash
# Check Nginx status
sudo systemctl status nginx

# Test Nginx config
sudo nginx -t

# Check DNS
dig your-domain.com
nslookup your-domain.com

# Check firewall
sudo ufw status
```

### High memory/CPU usage

```bash
# Check resource usage
top
htop
pm2 monit

# Restart application
# Docker:
sudo docker-compose restart

# PM2:
pm2 restart asana-planner

# Systemd:
sudo systemctl restart asana-planner
```

### SSL Certificate issues

```bash
# Test SSL
curl -vI https://your-domain.com

# Renew certificate
sudo certbot renew --force-renewal

# Check certificate expiry
sudo certbot certificates
```

---

## Security Best Practices

### 1. Keep System Updated
```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Configure Firewall
```bash
sudo ufw enable
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

### 3. Disable Root Login
```bash
sudo nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
sudo systemctl restart sshd
```

### 4. Use Strong Passwords
```bash
# Generate strong password
openssl rand -base64 32
```

### 5. Regular Backups
Set up automated daily backups using cron

### 6. Monitor Logs
Regularly check application and system logs for anomalies

---

## Production Checklist

- [ ] Node.js installed and updated
- [ ] Application deployed and tested locally
- [ ] Process manager configured (PM2/Systemd/Docker)
- [ ] Nginx reverse proxy configured
- [ ] SSL certificate installed and working
- [ ] Firewall configured
- [ ] Domain DNS pointing to server
- [ ] Health checks passing
- [ ] Monitoring set up
- [ ] Backup strategy in place
- [ ] Auto-restart on failure configured
- [ ] Logs rotating properly
- [ ] Security headers configured
- [ ] Application accessible via HTTPS
- [ ] Performance optimized

---

## Quick Deploy Script

Save as `deploy.sh` and run with `bash deploy.sh`

```bash
#!/bin/bash
# Quick deployment script

echo "🚀 Starting deployment..."

# Pull latest code
git pull

# Install dependencies
npm ci --only=production

# Restart application
if command -v pm2 &> /dev/null; then
    pm2 restart asana-planner
elif [ -f /etc/systemd/system/asana-planner.service ]; then
    sudo systemctl restart asana-planner
elif command -v docker-compose &> /dev/null; then
    sudo docker-compose up -d --build
fi

echo "✅ Deployment complete!"
```

---

## Support & Resources

- **Asana API Docs**: https://developers.asana.com/
- **Node.js Docs**: https://nodejs.org/docs/
- **PM2 Docs**: https://pm2.keymetrics.io/docs/
- **Nginx Docs**: https://nginx.org/en/docs/
- **Docker Docs**: https://docs.docker.com/

---

**Deployment completed!** 🎉

Your Asana Task Planner should now be running in production.
