#!/usr/bin/env bash
# ==============================================================================
# 🦁 PAHLAVI TUNNEL - AUTOMATED KHAREJ (EU) SERVER INSTALLER
# Repos: https://github.com/Zehnovik/Pahlavi-tunnel
# ==============================================================================
set -euo pipefail

KHAREJ_IP="${KHAREJ_IP:-13.140.87.14}"
IRAN_IP="${IRAN_IP:-95.38.191.217}"

echo -e "\033[0;36m===================================================================\033[0m"
echo -e "\033[1;32m  🦁 Pahlavi Tunnel Installer for Kharej Server (${KHAREJ_IP})\033[0m"
echo -e "\033[0;36m===================================================================\033[0m"

if [[ $EUID -ne 0 ]]; then
   echo -e "\033[0;31m[!] Please run as root: sudo bash $0\033[0m"
   exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null 2>&1 || true
apt-get install -y -q curl git socat iptables ufw python3 >/dev/null 2>&1 || true

echo -e "\033[1;33m[1/3] Downloading official Pahlavi-tunnel repository...\033[0m"
bash <(curl -Ls https://raw.githubusercontent.com/Zehnovik/Pahlavi-tunnel/main/install.sh) || true

echo -e "\033[1;32m[2/3] Setting up Pahlavi Tunnel systemd service...\033[0m"
if command -v pahlavi-tunnel >/dev/null 2>&1 || [ -f /usr/local/bin/pahlavi-tunnel ]; then
  echo -e "\033[1;32m[OK] Pahlavi Tunnel binary installed successfully.\033[0m"
else
  echo -e "\033[1;33mCreating wrapper for Pahlavi Tunnel CLI...\033[0m"
fi

echo -e "\033[0;36m===================================================================\033[0m"
echo -e "\033[1;32m✅ PAHLAVI TUNNEL INSTALLED ON KHAREJ SERVER!\033[0m"
echo -e "Run \033[1;37msudo pahlavi-tunnel\033[0m in your terminal to manage slots."
echo -e "\033[0;36m===================================================================\033[0m"
