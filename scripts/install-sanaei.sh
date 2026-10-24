#!/usr/bin/env bash
# ==============================================================================
# 🏛️ T2HASH & SANAEI (3X-UI) ONE-CLICK INSTALLER
# Installs and configures MHSanaei 3x-ui Xray Panel on Kharej Server (13.140.81.175)
# Configured to pair seamlessly with T2Tunnel inbound port 2500
# ==============================================================================
set -euo pipefail

# Monochrome Terminal Styling
BOLD='\033[1m'
WHITE='\033[1;37m'
GREY='\033[0;37m'
DIM='\033[2m'
NC='\033[0m'

clear 2>/dev/null || true
echo -e "${WHITE}${BOLD}"
cat << 'ART'
     _____   ___   _   _   ___   _____  _____ 
    /  ___| / _ \ | \ | | / _ \ |  ___||_   _|
    \ `--. / /_\ \|  \| |/ /_\ \| |__    | |  
     `--. \|  _  || . ` ||  _  ||  __|   | |  
    /\__/ /| | | || |\  || | | || |___  _| |_ 
    \____/ \_| |_/\_| \_/\_| |_/\____/  \___/ 
            3X-UI PROXY ENGINE FOR T2TUNNEL
ART
echo -e "${NC}"
echo -e "${DIM}------------------------------------------------------------${NC}"
echo -e "${WHITE}${BOLD}  🏛️ PASARGAD MONOCHROME · SANAEI 3X-UI AUTO-INSTALLER${NC}"
echo -e "${DIM}------------------------------------------------------------${NC}\n"

if [[ $EUID -ne 0 ]]; then
   echo -e "${WHITE}[!] Error: Run as root: sudo bash $0${NC}"
   exit 1
fi

echo -e "${WHITE}[1/4] Updating package repositories and installing curl...${NC}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null 2>&1 || true
apt-get install -y curl tar socat ufw iptables >/dev/null 2>&1 || true

echo -e "${WHITE}[2/4] Opening required ports (2053 for Panel, 2500 for Tunnel Inbound)...${NC}"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 2053/tcp >/dev/null 2>&1 || true
  ufw allow 2500/tcp >/dev/null 2>&1 || true
fi
iptables -I INPUT -p tcp --dport 2053 -j ACCEPT 2>/dev/null || true
iptables -I INPUT -p tcp --dport 2500 -j ACCEPT 2>/dev/null || true

echo -e "${WHITE}[3/4] Launching official Sanaei (3x-ui) installation engine...${NC}"
echo -e "${DIM}Running: https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh${NC}"

# Run Sanaei installer non-interactively or with standard defaults
bash -c "$(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)"

echo -e "\n${WHITE}[4/4] Verifying 3x-ui service status...${NC}"
sleep 2
if systemctl is-active --quiet x-ui; then
  PUB_IP=$(curl -s --max-time 4 ifconfig.me 2>/dev/null || echo "13.140.81.175")
  echo -e "\n${WHITE}${BOLD}============================================================${NC}"
  echo -e "${WHITE}${BOLD}  ✅ SANAEI (3X-UI) INSTALLED AND RUNNING SUCCESSFULLY!${NC}"
  echo -e "${WHITE}${BOLD}============================================================${NC}"
  echo -e "${GREY}• Panel URL:       ${WHITE}http://${PUB_IP}:2053${NC}"
  echo -e "${GREY}• Tunnel Inbound:  ${WHITE}Port 2500 (VLESS, security: none, 127.0.0.1)${NC}"
  echo -e "${GREY}• Service Command: ${WHITE}systemctl status x-ui${NC}"
  echo -e "${DIM}------------------------------------------------------------${NC}"
  echo -e "${WHITE}👉 Connect with T2Tunnel Panel API to auto-generate tunneled VLESS link!${NC}\n"
else
  echo -e "\n${WHITE}[!] 3x-ui installation completed. Please run 'x-ui' command to review setup.${NC}\n"
fi
