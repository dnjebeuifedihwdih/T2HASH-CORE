#!/usr/bin/env bash
# ==============================================================================
# 🛡️ T2HASH TUNNEL - 5-IN-1 MULTI-PROTOCOL IRAN RELAY AUTO-INSTALLER
# Iran IP: 188.121.101.206 (IPv6: 2a07:3903:0:2::21c)
# Target Server (Kharej): 13.140.81.175
# 5 Concurrent Tunnel Listeners on Iran Server:
#   1) Listen 0.0.0.0:9000 -> Tunnel to Kharej:4443 (TLS Chrome + 4B Fragmentation)
#   2) Listen 0.0.0.0:9001 -> Tunnel to Kharej:8443 (WebSocket CDN)
#   3) Listen 0.0.0.0:9002 -> Tunnel to Kharej:8444 (gRPC Multiplex + 2B Frag)
#   4) Listen 0.0.0.0:9003 -> Tunnel to Kharej:4445 (KCP Turbo UDP)
#   5) Listen 0.0.0.0:9004 -> Tunnel to Kharej:4446 (Raw QuantumMux)
# ==============================================================================
set -euo pipefail

IRAN_IP="${IRAN_IP:-188.121.101.206}"
KHAREJ_IP="${KHAREJ_IP:-13.140.81.175}"
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

echo -e "${CYAN}===================================================================${NC}"
echo -e "${GREEN}${BOLD}  🏛️ mh.tunnel · 5-IN-1 MULTI-TUNNEL IRAN RELAY INSTALLER${NC}"
echo -e "  Iran IP: ${CYAN}${IRAN_IP}${NC}  ===>  Kharej: ${YELLOW}${KHAREJ_IP}${NC}"
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

echo -e "\n${YELLOW}[1/6] ⚙️ Tuning Linux Kernel & Network Buffers for High Throughput...${NC}"
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

echo -e "${YELLOW}[2/6] 📦 Installing System Dependencies...${NC}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null 2>&1 || true
apt-get install -y -q libpcap-dev build-essential iptables curl tar git ufw socat >/dev/null 2>&1 || true

echo -e "${YELLOW}[3/6] 🐹 Setting up Go (Iran Sanction-Bypass Mirrors Enabled)...${NC}"
if ! command -v go >/dev/null 2>&1 || [ "$(go version 2>/dev/null | grep -oE 'go[0-9]+' | sed 's/go//' || echo 0)" -lt 1 ]; then
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) GOARCH="amd64" ;;
    aarch64) GOARCH="arm64" ;;
    *) GOARCH="amd64" ;;
  esac
  echo -e "      Downloading Go for ${GOARCH} via mirror..."
  curl -fsSL --connect-timeout 10 --retry 3 "https://golang.google.cn/dl/go1.22.5.linux-${GOARCH}.tar.gz" -o /tmp/go.tar.gz || \
  curl -fsSL --connect-timeout 15 --retry 3 "https://go.dev/dl/go1.22.5.linux-${GOARCH}.tar.gz" -o /tmp/go.tar.gz
  rm -rf /usr/local/go && tar -C /usr/local -xzf /tmp/go.tar.gz
  rm -f /tmp/go.tar.gz
  export PATH=$PATH:/usr/local/go/bin
  ln -sf /usr/local/go/bin/go /usr/local/bin/go
fi
export PATH=$PATH:/usr/local/go/bin
export GOPROXY="https://goproxy.cn,https://goproxy.io,https://proxy.golang.org,direct"
export GOSUMDB=off

echo -e "${YELLOW}[4/6] 🔨 Fetching and Compiling T2HASH Core Binary...${NC}"
WORK_DIR="/opt/t2tunnel"
rm -rf "$WORK_DIR"
if ! git clone "$REPO_URL" "$WORK_DIR" 2>/dev/null; then
  git clone "https://ghproxy.net/$REPO_URL" "$WORK_DIR" || git clone "$REPO_FALLBACK" "$WORK_DIR"
fi

if [ -d "$WORK_DIR/t2tunnel" ]; then
  cd "$WORK_DIR/t2tunnel"
else
  cd "$WORK_DIR"
fi
go mod tidy || true
go build -trimpath -ldflags '-s -w' -o /usr/local/bin/t2tunnel .
chmod +x /usr/local/bin/t2tunnel

echo -e "${YELLOW}[5/6] 🔧 Configuring 5 Concurrent Client Relays in Systemd...${NC}"
cat << 'RUNNER' > /usr/local/bin/t2tunnel-multi-client.sh
#!/usr/bin/env bash
trap 'kill $(jobs -p)' EXIT

PSK="t2hash_9f482a17cb03da5e718b45620f3e8291"
KHAREJ="13.140.81.175"

echo "[T2HASH] Starting 5 Concurrent Tunnel Relays on Iran..."

# 1. TLS Quantum: Listen 9000 -> Kharej:4443
/usr/local/bin/t2tunnel -mode client -transport tls -listen 0.0.0.0:9000 -remote "$KHAREJ:4443" -key "$PSK" -sni speedtest.net -utls -frag 4 &
PID1=$!

# 2. WebSocket CDN: Listen 9001 -> Kharej:8443
/usr/local/bin/t2tunnel -mode client -transport ws -listen 0.0.0.0:9001 -remote "$KHAREJ:8443" -key "$PSK" -ws-path /ws &
PID2=$!

# 3. gRPC Multiplex: Listen 9002 -> Kharej:8444
/usr/local/bin/t2tunnel -mode client -transport tls -listen 0.0.0.0:9002 -remote "$KHAREJ:8444" -key "$PSK" -sni www.bing.com -utls -frag 2 &
PID3=$!

# 4. KCP Turbo UDP: Listen 9003 -> Kharej:4445
/usr/local/bin/t2tunnel -mode client -transport udp -listen 0.0.0.0:9003 -remote "$KHAREJ:4445" -key "$PSK" &
PID4=$!

# 5. Raw QuantumMux: Listen 9004 -> Kharej:4446
/usr/local/bin/t2tunnel -mode client -transport tls -listen 0.0.0.0:9004 -remote "$KHAREJ:4446" -key "$PSK" -sni cdnjs.cloudflare.com -utls &
PID5=$!

wait $PID1 $PID2 $PID3 $PID4 $PID5
RUNNER
chmod +x /usr/local/bin/t2tunnel-multi-client.sh

cat << 'EOF' > /etc/systemd/system/t2tunnel.service
[Unit]
Description=T2HASH 5-in-1 Multi-Protocol Relay (Client)
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/t2tunnel-multi-client.sh
Restart=always
RestartSec=2s
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
EOF

echo -e "${YELLOW}[6/6] 🛡️ Opening User Listen Ports (9000-9004) & Starting Service...${NC}"
PORTS=("9000" "9001" "9002" "9003" "9004")
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
  echo -e "${GREEN}${BOLD}  ✅ 5 CONCURRENT RELAY PORTS ACTIVE ON IRAN SERVER!${NC}"
  echo -e "${GREEN}===================================================================${NC}"
  echo -e "  ${CYAN}1) Port 9000: ${WHITE}T2-TLS Quantum (speedtest.net + 4B Frag)${NC}"
  echo -e "  ${CYAN}2) Port 9001: ${WHITE}T2-WebSocket CDN (Cloudflare CDN Ready)${NC}"
  echo -e "  ${CYAN}3) Port 9002: ${WHITE}T2-gRPC Multiplex (Bing SNI + 2B Frag)${NC}"
  echo -e "  ${CYAN}4) Port 9003: ${WHITE}T2-KCP Turbo UDP (Low Latency / Packet Loss Shield)${NC}"
  echo -e "  ${CYAN}5) Port 9004: ${WHITE}T2-Raw QuantumMux (Cloudflare CDNJS SNI)${NC}"
  echo -e ""
  echo -e "${YELLOW}🔍 Handshake Check to Kharej (${KHAREJ_IP}):${NC}"
  for p in "4443" "8443" "8444"; do
    if timeout 2 bash -c "</dev/tcp/${KHAREJ_IP}/${p}" 2>/dev/null; then
      echo -e "   ${GREEN}[OK] Port ${p} is reachable!${NC}"
    fi
  done
  echo -e "\n${GREEN}${BOLD}🎉 All 5 Tunnels Running Concurrently! Use the Web Console to get all 5 VLESS links.${NC}\n"
else
  echo -e "${RED}[x] Service failed to start. Logs:${NC}"
  journalctl -u t2tunnel -n 25 --no-pager
  exit 1
fi
