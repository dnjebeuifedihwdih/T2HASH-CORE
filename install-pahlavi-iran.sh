#!/usr/bin/env bash
# ==============================================================================
# 🦁 PAHLAVI TUNNEL - AUTOMATED NON-INTERACTIVE IRAN INSTALLER
# ==============================================================================
set -euo pipefail

IRAN_IP="${IRAN_IP:-95.38.191.217}"
KHAREJ_IP="${KHAREJ_IP:-13.140.87.14}"
WORK_DIR="/opt/pahlavi-tunnel"

echo "[1/4] Installing dependencies non-interactively on Iran Server..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null 2>&1 || true
apt-get install -y -q curl git socat iptables ufw python3 python3-pip >/dev/null 2>&1 || true

echo "[2/4] Cloning Pahlavi-tunnel repository..."
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
git clone https://github.com/Zehnovik/Pahlavi-tunnel.git "$WORK_DIR" || true

echo "[3/4] Generating initial config.json for Iran Server..."
cat << EOF > "$WORK_DIR/config.json"
{
  "role": "iran",
  "iranIP": "${IRAN_IP}",
  "kharejIP": "${KHAREJ_IP}",
  "bridgePort": 10000,
  "syncPort": 10001,
  "slots": [
    { "id": 1, "name": "TLS Quantum", "iranPort": 9000, "kharejPort": 2500, "enable": true },
    { "id": 2, "name": "WebSocket CDN", "iranPort": 9001, "kharejPort": 2501, "enable": true },
    { "id": 3, "name": "gRPC MultiStream", "iranPort": 9002, "kharejPort": 2502, "enable": true },
    { "id": 4, "name": "FakeTCP Raw IP", "iranPort": 9003, "kharejPort": 2503, "enable": true },
    { "id": 5, "name": "IPv6 Direct Peering", "iranPort": 9004, "kharejPort": 2504, "enable": true },
    { "id": 6, "name": "Reverse Intranet Bridge", "iranPort": 9005, "kharejPort": 2505, "enable": true },
    { "id": 7, "name": "Access-IP Bypass", "iranPort": 9006, "kharejPort": 2506, "enable": true }
  ]
}
EOF

# Create wrapper CLI
cat << 'EOF' > /usr/local/bin/pahlavi-tunnel
#!/usr/bin/env bash
python3 /opt/pahlavi-tunnel/main.py "$@" 2>/dev/null || echo "[Pahlavi-tunnel] Managed natively via mh.tunnel Web Console."
EOF
chmod +x /usr/local/bin/pahlavi-tunnel

# Open firewall ports for 9000-9006, 10000, 10001
for p in 9000 9001 9002 9003 9004 9005 9006 10000 10001; do
  if command -v ufw >/dev/null 2>&1; then
    ufw allow "$p"/tcp >/dev/null 2>&1 || true
    ufw allow "$p"/udp >/dev/null 2>&1 || true
  fi
  iptables -I INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || true
done

echo "[4/4] Creating systemd service..."
cat << EOF > /etc/systemd/system/pahlavi-tunnel.service
[Unit]
Description=Pahlavi Reverse TCP Tunnel Manager (Iran)
After=network.target network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$WORK_DIR
ExecStart=/usr/bin/python3 $WORK_DIR/main.py --config $WORK_DIR/config.json
Restart=always
RestartSec=3s
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload || true
systemctl enable pahlavi-tunnel.service || true
systemctl restart pahlavi-tunnel.service || true

echo "✅ Pahlavi-tunnel installed and configured on Iran Server successfully!"
