#!/usr/bin/env bash
# ==============================================================================
# 🦁 PAHLAVI TUNNEL - AUTOMATED IRAN SERVER INSTALLER
# Repos: https://github.com/Zehnovik/Pahlavi-tunnel
# ==============================================================================
set -euo pipefail

IRAN_IP="${IRAN_IP:-95.38.191.217}"
KHAREJ_IP="${KHAREJ_IP:-13.140.87.14}"

echo -e "\033[0;36m===================================================================\033[0m"
echo -e "\033[1;32m  🦁 Pahlavi Tunnel Installer for Iran Server (${IRAN_IP})\033[0m"
echo -e "  Connecting to Kharej EU Server: \033[1;33m${KHAREJ_IP}\033[0m"
echo -e "\033[0;36m===================================================================\033[0m"

if [[ $EUID -ne 0 ]]; then
   echo -e "\033[0;31m[!] Please run as root: sudo bash $0\033[0m"
   exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null 2>&1 || true
apt-get install -y -q curl git socat iptables ufw python3 >/dev/null 2>&1 || true

echo -e "\033[1;33m[1/3] Downloading official Pahlavi-tunnel repository on Iran server...\033[0m"
bash <(curl -Ls https://raw.githubusercontent.com/Zehnovik/Pahlavi-tunnel/main/install.sh) || true

echo -e "\033[1;32m[2/3] Opening firewall ports for Pahlavi Bridge & Sync...\033[0m"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 8080/tcp >/dev/null 2>&1 || true
  ufw allow 8443/tcp >/dev/null 2>&1 || true
  ufw allow 2083/tcp >/dev/null 2>&1 || true
  ufw allow 2053/tcp >/dev/null 2>&1 || true
fi

echo -e "\033[0;36m===================================================================\033[0m"
echo -e "\033[1;32m✅ PAHLAVI TUNNEL INSTALLED ON IRAN SERVER!\033[0m"
echo -e "Run \033[1;37msudo pahlavi-tunnel\033[0m in terminal to configure IRAN slots."
echo -e "\033[0;36m===================================================================\033[0m"
