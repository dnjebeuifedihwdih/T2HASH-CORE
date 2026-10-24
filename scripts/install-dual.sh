#!/usr/bin/env bash
# ==============================================================================
# 🛡️ T2HASH TUNNEL - UNIFIED DUAL-SERVER INSTALLER
# Works for both Iran Server (188.121.101.206) and Kharej Server (13.140.81.175)
# ==============================================================================
set -euo pipefail

P='\033[38;5;80m'; C='\033[38;5;87m'; G='\033[38;5;83m'; R='\033[38;5;203m'; Y='\033[38;5;227m'; N='\033[0m'; B='\033[1m'

clear 2>/dev/null || true
echo -e "${P}${B}"
cat << 'ART'
        ########  ######   ##  ##   ####    #####  ##  ##
           ##        ##     ##  ##  ##  ##  ##      ##  ##
           ##      #####   ######  ######   ####   ######
           ##         ##   ##  ##  ##  ##      ##   ##  ##
           ##     #######  ##  ##  ##  ##  #####    ##  ##
ART
echo -e "${N}"
echo -e "        ${C}T U N N E L${N}   -   Dual Server Anti-DPI Installer v2.4\n"

if [[ $EUID -ne 0 ]]; then
   echo -e "  ${R}[!] Please run as root: sudo bash $0${N}"
   exit 1
fi

echo -e "  ${B}Which server component are you setting up right now?${N}\n"
echo -e "    ${P}1)${N} ${B}Kharej / Foreign Server${N}  ${C}(13.140.81.175)${N} - Role: SERVER"
echo -e "    ${P}2)${N} ${B}Iran Relay Server${N}        ${C}(188.121.101.206)${N} - Role: CLIENT"
echo -e "    ${P}3)${N} ${B}Sanaei (3x-ui) Panel${N}     ${C}(Kharej Server)${N} - Xray Core & Web UI"
echo -e "    ${P}4)${N} Exit\n"

while true; do
  read -rp "  Choose [1/2/3/4]: " CHOICE
  case "$CHOICE" in
    1)
      SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
      if [[ -f "$SCRIPT_DIR/install-kharej.sh" ]]; then
        bash "$SCRIPT_DIR/install-kharej.sh"
      else
        curl -fsSL "https://raw.githubusercontent.com/dnjebeuifedihwdih/T2HASH-CORE/main/install-kharej.sh" | sudo bash
      fi
      break
      ;;
    2)
      SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
      if [[ -f "$SCRIPT_DIR/install-iran.sh" ]]; then
        bash "$SCRIPT_DIR/install-iran.sh"
      else
        curl -fsSL "https://raw.githubusercontent.com/dnjebeuifedihwdih/T2HASH-CORE/main/install-iran.sh" | sudo bash
      fi
      break
      ;;
    3)
      SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
      if [[ -f "$SCRIPT_DIR/install-sanaei.sh" ]]; then
        bash "$SCRIPT_DIR/install-sanaei.sh"
      else
        curl -fsSL "https://raw.githubusercontent.com/dnjebeuifedihwdih/T2HASH-CORE/main/install-sanaei.sh" | sudo bash
      fi
      break
      ;;
    4)
      echo -e "\n  ${Y}Setup cancelled.${N}\n"
      exit 0
      ;;
    *)
      echo -e "  ${R}Please enter 1, 2, 3, or 4.${N}"
      ;;
  esac
done
