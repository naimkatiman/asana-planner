#!/bin/bash
# Quick Deployment Script for Asana Task Planner

set -e

echo "🚀 Asana Task Planner - Quick Deploy"
echo "===================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo -e "${RED}Please do not run as root${NC}"
   exit 1
fi

# Detect deployment method
if command -v pm2 &> /dev/null; then
    METHOD="pm2"
    echo -e "${GREEN}✓${NC} Detected PM2"
elif [ -f /etc/systemd/system/asana-planner.service ]; then
    METHOD="systemd"
    echo -e "${GREEN}✓${NC} Detected Systemd service"
elif command -v docker-compose &> /dev/null; then
    METHOD="docker"
    echo -e "${GREEN}✓${NC} Detected Docker"
else
    echo -e "${YELLOW}⚠${NC} No deployment method detected. Please install PM2, Docker, or setup Systemd."
    exit 1
fi

echo ""
echo "📦 Pulling latest code..."
git pull || echo -e "${YELLOW}⚠${NC} Git pull failed (continuing anyway)"

echo ""
echo "📚 Installing dependencies..."
npm ci --only=production --quiet

echo ""
echo "🔄 Restarting application..."

case $METHOD in
    "pm2")
        pm2 restart asana-planner
        pm2 save
        echo -e "${GREEN}✓${NC} Restarted with PM2"
        echo ""
        echo "📊 Application Status:"
        pm2 status asana-planner
        ;;
    "systemd")
        sudo systemctl restart asana-planner
        echo -e "${GREEN}✓${NC} Restarted with Systemd"
        echo ""
        echo "📊 Application Status:"
        sudo systemctl status asana-planner --no-pager
        ;;
    "docker")
        sudo docker-compose up -d --build
        echo -e "${GREEN}✓${NC} Restarted with Docker"
        echo ""
        echo "📊 Container Status:"
        sudo docker-compose ps
        ;;
esac

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🔍 Test your deployment:"
echo "  Local:  curl http://localhost:3000/api/credentials/status"
echo "  Domain: curl https://your-domain.com/api/credentials/status"
echo ""
