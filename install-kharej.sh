#!/usr/bin/env bash
# ==============================================================================
# 🛡️ T2HASH TUNNEL - 7-IN-1 MULTI-PROTOCOL SERVER AUTO-INSTALLER
# Kharej Server IP: 13.140.81.175  |  Iran Server IP: 188.121.101.206
# 7 Concurrent Tunnels for Maximum Resilience (Anti-Censorship + Reverse Intranet):
#   1) T2-TLS Quantum (Port 4443 -> Inbound 2500)
#   2) T2-WebSocket CDN (Port 8443 -> Inbound 2501)
#   3) T2-gRPC Multiplex (Port 8444 -> Inbound 2502)
#   4) T2-KCP Turbo UDP (Port 4445 -> Inbound 2503)
#   5) T2-Raw QuantumMux (Port 4446 -> Inbound 2504)
#   6) T2-Reverse Intranet Bridge (Port 4447 <-> Inbound 2505) [اینترنت ملی / سرور بدون اینترنت]
#   7) T2-Reverse Access-IP Bypass (Port 4448 <-> Inbound 2506) [آی‌پی اکسس‌شده و لیست سفید]
# ==============================================================================
set -euo pipefail

KHAREJ_IP="${KHAREJ_IP:-13.140.81.175}"
IRAN_IP="${IRAN_IP:-188.121.101.206}"
PSK_KEY="${PSK_KEY:-t2hash_9f482a17cb03da5e718b45620f3e8291}"
REPO_URL="https://github.com/dnjebeuifedihwdih/T2HASH-CORE.git"
REPO_FALLBACK="https://ghproxy.net/https://github.com/dnjebeuifedihwdih/T2HASH-CORE.git"

# Terminal Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'
WHITE='\033[1;37m'

echo -e "${CYAN}===================================================================${NC}"
echo -e "${GREEN}${BOLD}  🏛️ mh.tunnel · 7-IN-1 MULTI-TUNNEL SERVER INSTALLER${NC}"
echo -e "  Server IP: ${CYAN}${KHAREJ_IP}${NC}  |  Iran Peer: ${YELLOW}${IRAN_IP}${NC}"
echo -e "  Features: 7 Concurrent Anti-DPI & Reverse Intranet Tunnels"
echo -e "${CYAN}===================================================================${NC}"

if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}[!] Please run this script as root: sudo bash $0${NC}"
   exit 1
fi

# 0. Check and Create Swap for 1GB RAM / 1 vCPU VPS
RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
SWAP_MB=$(free -m | awk '/^Swap:/{print $2}')
if [ "$RAM_MB" -lt 1600 ] && [ "$SWAP_MB" -lt 500 ]; then
  echo -e "${YELLOW}[!] Low RAM detected (${RAM_MB}MB). Creating 1.5GB swap for smooth operation...${NC}"
  fallocate -l 1536M /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=1536
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null 2>&1
  swapon /swapfile >/dev/null 2>&1 || true
  grep -q "/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab 2>/dev/null || true
  echo -e "${GREEN}[OK] Swap active.${NC}"
fi

echo -e "\n${YELLOW}[1/7] ⚙️ Tuning Linux Kernel & Network Buffers (BBR + FQ)...${NC}"
cat << 'EOF' > /etc/sysctl.d/99-t2tunnel.conf
fs.file-max = 1000000
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_max_syn_backlog = 8192
net.core.somaxconn = 32768
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
EOF
sysctl -p /etc/sysctl.d/99-t2tunnel.conf >/dev/null 2>&1 || true

echo -e "${YELLOW}[2/7] 📦 Installing System Dependencies...${NC}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null 2>&1 || true
apt-get install -y -q libpcap-dev build-essential iptables curl tar git ufw socat >/dev/null 2>&1 || true

echo -e "${YELLOW}[3/7] 🐹 Setting up Go Compiler (1.22+)...${NC}"
if ! command -v go >/dev/null 2>&1 || [ "$(go version 2>/dev/null | grep -oE 'go[0-9]+' | sed 's/go//' || echo 0)" -lt 1 ]; then
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) GOARCH="amd64" ;;
    aarch64) GOARCH="arm64" ;;
    *) GOARCH="amd64" ;;
  esac
  echo -e "      Downloading Go for ${GOARCH}..."
  curl -fsSL --retry 3 "https://go.dev/dl/go1.22.5.linux-${GOARCH}.tar.gz" -o /tmp/go.tar.gz || \
  curl -fsSL --retry 3 "https://golang.google.cn/dl/go1.22.5.linux-${GOARCH}.tar.gz" -o /tmp/go.tar.gz
  rm -rf /usr/local/go && tar -C /usr/local -xzf /tmp/go.tar.gz
  rm -f /tmp/go.tar.gz
  export PATH=$PATH:/usr/local/go/bin
  ln -sf /usr/local/go/bin/go /usr/local/bin/go
fi
export PATH=$PATH:/usr/local/go/bin
export GOPROXY="https://goproxy.io,https://proxy.golang.org,direct"
export GOSUMDB=off

echo -e "${YELLOW}[4/7] 🔨 Fetching and Compiling T2HASH Core Binary...${NC}"
WORK_DIR="/opt/t2tunnel"
rm -rf "$WORK_DIR"
if ! git clone "$REPO_URL" "$WORK_DIR" 2>/dev/null; then
  git clone "$REPO_FALLBACK" "$WORK_DIR" || git clone "https://ghproxy.net/$REPO_URL" "$WORK_DIR"
fi

if [ -d "$WORK_DIR/t2tunnel" ]; then
  cd "$WORK_DIR/t2tunnel"
else
  cd "$WORK_DIR"
fi
go mod tidy || true
go build -trimpath -ldflags '-s -w' -o /usr/local/bin/t2tunnel .
chmod +x /usr/local/bin/t2tunnel

echo -e "${YELLOW}[5/7] 🔧 Generating 7-in-1 Multi-Tunnel Runner Script & Systemd Unit...${NC}"
cat << RUNNER > /usr/local/bin/t2tunnel-multi-server.sh
#!/usr/bin/env bash
trap 'kill \$(jobs -p)' EXIT

PSK="${PSK_KEY}"
IRAN="${IRAN_IP}"

echo "[T2HASH] Starting 7 Concurrent Tunnel Listeners on Server..."

# 1. TLS Mimicry (Anti-DPI)
/usr/local/bin/t2tunnel -mode server -transport tls -listen 0.0.0.0:4443 -target 127.0.0.1:2500 -key "\$PSK" -sni speedtest.net &
PID1=\$!

# 2. WebSocket CDN
/usr/local/bin/t2tunnel -mode server -transport ws -listen 0.0.0.0:8443 -target 127.0.0.1:2501 -key "\$PSK" -ws-path /ws &
PID2=\$!

# 3. gRPC Multiplex
/usr/local/bin/t2tunnel -mode server -transport tls -listen 0.0.0.0:8444 -target 127.0.0.1:2502 -key "\$PSK" -sni www.bing.com &
PID3=\$!

# 4. KCP Turbo UDP
/usr/local/bin/t2tunnel -mode server -transport udp -listen 0.0.0.0:4445 -target 127.0.0.1:2503 -key "\$PSK" &
PID4=\$!

# 5. Raw TCP Mux
/usr/local/bin/t2tunnel -mode server -transport tls -listen 0.0.0.0:4446 -target 127.0.0.1:2504 -key "\$PSK" -sni cdnjs.cloudflare.com &
PID5=\$!

# 6. T2-Reverse Intranet Bridge (مخصوص اینترنت ملی و سرور بدون اینترنت)
# Kharej maintains reverse connection into Iran or accepts reverse push:
/usr/local/bin/t2tunnel -mode reverse-bridge -remote "\$IRAN:4447" -target 127.0.0.1:2505 -key "\$PSK" -sni speedtest.net &
PID6=\$!

# 7. T2-Reverse Access-IP Bypass (مخصوص سرور با آی‌پی اکسس‌شده و دامنه‌های مجاز)
/usr/local/bin/t2tunnel -mode server -transport tls -listen 0.0.0.0:4448 -target 127.0.0.1:2506 -key "\$PSK" -sni divar.ir &
PID7=\$!

wait \$PID1 \$PID2 \$PID3 \$PID4 \$PID5 \$PID6 \$PID7
RUNNER
chmod +x /usr/local/bin/t2tunnel-multi-server.sh

cat << 'EOF' > /etc/systemd/system/t2tunnel.service
[Unit]
Description=T2HASH 7-in-1 Multi-Protocol Tunnel (Server)
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/t2tunnel-multi-server.sh
Restart=always
RestartSec=2s
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
EOF

echo -e "${YELLOW}[6/7] 🛡️ Opening All 7 Ports in Firewall...${NC}"
PORTS=("4443" "8443" "8444" "4445" "4446" "4447" "4448" "2053" "2500" "2501" "2502" "2503" "2504" "2505" "2506")
for p in "${PORTS[@]}"; do
  if command -v ufw >/dev/null 2>&1; then
    ufw allow "$p"/tcp >/dev/null 2>&1 || true
    ufw allow "$p"/udp >/dev/null 2>&1 || true
  fi
  iptables -I INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || true
  iptables -I INPUT -p udp --dport "$p" -j ACCEPT 2>/dev/null || true
done

systemctl daemon-reload
systemctl enable t2tunnel.service
systemctl restart t2tunnel.service

sleep 2
if systemctl is-active --quiet t2tunnel; then
  echo -e "\n${GREEN}===================================================================${NC}"
  echo -e "${GREEN}${BOLD}  ✅ 7 CONCURRENT TUNNELS INSTALLED & ACTIVE ON SERVER!${NC}"
  echo -e "${GREEN}===================================================================${NC}"
  echo -e "  ${CYAN}1) TLS Quantum:            ${WHITE}Port 4443 -> Inbound 2500${NC}"
  echo -e "  ${CYAN}2) WebSocket CDN:          ${WHITE}Port 8443 -> Inbound 2501${NC}"
  echo -e "  ${CYAN}3) gRPC Multiplex:         ${WHITE}Port 8444 -> Inbound 2502${NC}"
  echo -e "  ${CYAN}4) KCP Turbo UDP:          ${WHITE}Port 4445 -> Inbound 2503${NC}"
  echo -e "  ${CYAN}5) Raw QuantumMux:         ${WHITE}Port 4446 -> Inbound 2504${NC}"
  echo -e "  ${GREEN}6) Reverse Intranet Bridge:${WHITE}Port 4447 <-> Inbound 2505 (اینترنت ملی/بدون اینترنت)${NC}"
  echo -e "  ${GREEN}7) Reverse Access-IP Bypass:${WHITE}Port 4448 <-> Inbound 2506 (آی‌پی اکسس‌شده)${NC}"
else
  echo -e "${RED}[x] Service failed to start. Logs:${NC}"
  journalctl -u t2tunnel -n 25 --no-pager
  exit 1
fi

echo -e "\n${YELLOW}[7/7] 🏛️ Verifying Sanaei (3x-ui) Panel Status...${NC}"
if ! systemctl is-active --quiet x-ui 2>/dev/null; then
  echo -e "${CYAN}Installing Sanaei (3x-ui) Xray Panel now...${NC}"
  bash -c "$(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)" || true
fi

echo -e "\n${GREEN}${BOLD}🎉 Kharej Server ready! Now run install-iran.sh on your Iran server.${NC}\n"
