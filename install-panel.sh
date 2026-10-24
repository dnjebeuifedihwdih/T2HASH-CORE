#!/usr/bin/env bash
# ==============================================================================
# 🏛️ mh.tunnel · STANDALONE WEB PANEL INSTALLER (3X-UI / SANAEI STYLE)
# Installs mh.tunnel Web Console as a systemd background service on port 3000
# ==============================================================================
set -euo pipefail

# Terminal Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'
WHITE='\033[1;37m'

echo -e "${CYAN}===================================================================${NC}"
echo -e "${GREEN}${BOLD}  🏛️ mh.tunnel · STANDALONE WEB CONSOLE INSTALLER${NC}"
echo -e "  Full Server Management Panel (3x-ui / Sanaei Style)"
echo -e "${CYAN}===================================================================${NC}"

if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}[!] Please run this installer as root: sudo bash $0${NC}"
   exit 1
fi

PANEL_DIR="/opt/mhtunnel-panel"
PANEL_PORT="${PANEL_PORT:-3000}"
PANEL_USER="${PANEL_USER:-admin}"
PANEL_PASS="${PANEL_PASS:-admin123}"
REPO_URL="https://github.com/dnjebeuifedihwdih/T2HASH-CORE.git"

# Detect Server IP
SERVER_IP=$(curl -s4 -m 5 https://api.ipify.org || curl -s4 -m 5 https://icanhazip.com || hostname -I | awk '{print $1}')

echo -e "\n${YELLOW}[1/5] 📦 Installing System Dependencies & Node.js Runtime...${NC}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null 2>&1 || true
apt-get install -y -q curl git tar ufw iptables >/dev/null 2>&1 || true

if ! command -v node >/dev/null 2>&1; then
  echo -e "      Installing Node.js package..."
  apt-get update -y >/dev/null 2>&1 || true
  apt-get install -y -q nodejs npm >/dev/null 2>&1 || true
fi

if ! command -v node >/dev/null 2>&1 || [ "$(node -v 2>/dev/null | grep -oE 'v[0-9]+' | sed 's/v//' || echo 0)" -lt 18 ]; then
  echo -e "      Upgrading to Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || true
  apt-get install -y -q nodejs >/dev/null 2>&1 || true
fi

echo -e "${GREEN}[OK] Node.js Version: $(node -v 2>/dev/null || echo 'Installed')${NC}"

echo -e "\n${YELLOW}[2/5] 📥 Deploying mh.tunnel Web Console Files to ${PANEL_DIR}...${NC}"
mkdir -p "$PANEL_DIR"
rm -rf "$PANEL_DIR/*"

if ! git clone "$REPO_URL" "$PANEL_DIR" 2>/dev/null; then
  git clone "https://ghproxy.net/$REPO_URL" "$PANEL_DIR" || true
fi

cd "$PANEL_DIR"
if [ -f "package.json" ]; then
  echo -e "      Installing Node.js dependencies..."
  npm install --omit=dev >/dev/null 2>&1 || npm install >/dev/null 2>&1 || true
fi

echo -e "\n${YELLOW}[3/5] ⚙️ Creating Systemd Daemon Service (mhtunnel-panel.service)...${NC}"
cat << EOF > /etc/systemd/system/mhtunnel-panel.service
[Unit]
Description=mh.tunnel Standalone Web Panel (Node.js)
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${PANEL_DIR}
ExecStart=$(which node || echo "/usr/bin/node") ${PANEL_DIR}/server.js
Restart=always
RestartSec=3s
Environment=PORT=${PANEL_PORT}
Environment=PANEL_USER=${PANEL_USER}
Environment=PANEL_PASS=${PANEL_PASS}
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mhtunnel-panel.service

echo -e "\n${YELLOW}[4/5] 🛡️ Opening Firewall Port ${PANEL_PORT}...${NC}"
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${PANEL_PORT}"/tcp >/dev/null 2>&1 || true
fi
iptables -I INPUT -p tcp --dport "${PANEL_PORT}" -j ACCEPT 2>/dev/null || true

echo -e "\n${YELLOW}[5/5] 🚀 Launching Panel Service...${NC}"
systemctl restart mhtunnel-panel.service

sleep 2

if systemctl is-active --quiet mhtunnel-panel; then
  echo -e "\n${GREEN}===================================================================${NC}"
  echo -e "${GREEN}${BOLD}  🎉 mh.tunnel WEB PANEL IS INSTALLED & RUNNING ON YOUR SERVER!${NC}"
  echo -e "${GREEN}===================================================================${NC}"
  echo -e "  ${CYAN}🌐 Panel Access URL:${WHITE} http://${SERVER_IP}:${PANEL_PORT}${NC}"
  echo -e "  ${CYAN}👤 Username:        ${WHITE}${PANEL_USER}${NC}"
  echo -e "  ${CYAN}🔑 Password:        ${WHITE}${PANEL_PASS}${NC}"
  echo -e "  ${CYAN}⚙️ Service Name:    ${WHITE}mhtunnel-panel.service${NC}"
  echo -e "==================================================================="
  echo -e "  ${YELLOW}Control Commands:${NC}"
  echo -e "  • Check Status: ${WHITE}systemctl status mhtunnel-panel${NC}"
  echo -e "  • Restart Panel:${WHITE}systemctl restart mhtunnel-panel${NC}"
  echo -e "  • Stop Panel:   ${WHITE}systemctl stop mhtunnel-panel${NC}"
  echo -e "  • View Logs:    ${WHITE}journalctl -u mhtunnel-panel -f${NC}"
  echo -e "===================================================================\n"
else
  echo -e "${RED}[x] Panel service failed to start. Logs:${NC}"
  journalctl -u mhtunnel-panel -n 30 --no-pager
  exit 1
fi
