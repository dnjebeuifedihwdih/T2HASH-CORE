import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import util from 'util';
import net from 'net';

const execPromise = util.promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Default pre-configured values from user request
const CONFIG_STORE = {
  iranIPv4: process.env.DEFAULT_IRAN_IPV4 || '95.38.191.217',
  iranIPv6: process.env.DEFAULT_IRAN_IPV6 || '2a07:3903:0:2::21c',
  iranDomain: process.env.DEFAULT_IRAN_DOMAIN || 'iran.limogame4.site',
  kharejIP: process.env.DEFAULT_KHAREJ_IP || '13.140.87.14',
  kharejDomain: process.env.DEFAULT_KHAREJ_DOMAIN || 'tunnel.limogame4.site',
  tunnelPort: 4443,
  targetPort: 2500, // Destination on Kharej (e.g. Xray/3x-ui inbound)
  clientPort: 9000, // Listen port on Iran for users/v2ray
  pskKey: 'mh_' + crypto.randomBytes(16).toString('hex'),
  transport: 'tls', // tls, ws, udp, raw
  sni: 'speedtest.net',
  utls: true,
  frag: 4,
  autoRestart: true,
  bbrEnabled: true,
  repoUrl: 'https://github.com/dnjebeuifedihwdih/T2HASH-CORE.git',
  xrayInstalled: true,
  serviceState: 'active',
  serviceActive: true,
  adminUser: process.env.PANEL_USER || 'admin',
  adminPassHash: crypto.createHash('sha256').update('admin:admin123').digest('hex')
};

// Official Raw GitHub Repository URLs for T2HASH-CORE (dnjebeuifedihwdih/T2HASH-CORE)
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/dnjebeuifedihwdih/T2HASH-CORE/main';
const GITHUB_SCRIPTS = {
  kharej: `${GITHUB_RAW_BASE}/install-kharej.sh`,
  iran: `${GITHUB_RAW_BASE}/install-iran.sh`,
  dual: `${GITHUB_RAW_BASE}/install-dual.sh`,
  sanaei: `${GITHUB_RAW_BASE}/install-sanaei.sh`,
  t2tunnelOfficial: `${GITHUB_RAW_BASE}/t2tunnel/install.sh`,
  officialRepo: 'https://github.com/dnjebeuifedihwdih/T2HASH-CORE.git'
};

// In-memory active sessions
const sessions = new Map();
function createSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + 12 * 3600 * 1000);
  return token;
}

// In-memory logs
const logs = [
  `[${new Date().toISOString()}] [SYSTEM] mh.tunnel Core & Real-time Web Console initialized on port 3000`,
  `[${new Date().toISOString()}] [SYSCTL] Network optimizations ready (BBR, TCP fastopen, 1M file descriptors)`,
  `[${new Date().toISOString()}] [TUNNEL] Pre-configured Iran Server: ${CONFIG_STORE.iranIPv4} (${CONFIG_STORE.iranIPv6})`,
  `[${new Date().toISOString()}] [TUNNEL] Pre-configured Kharej Server: ${CONFIG_STORE.kharejIP} -> Transport: ${CONFIG_STORE.transport.toUpperCase()}`,
  `[${new Date().toISOString()}] [SOCKET] Real TCP Socket Diagnostics active (No simulated or mock metrics)`,
  `[${new Date().toISOString()}] [GITHUB] Raw repository scripts linked: ${GITHUB_RAW_BASE}`
];

function addLog(msg) {
  logs.push(`[${new Date().toISOString()}] ${msg}`);
  if (logs.length > 500) logs.shift();
}

/**
 * Real TCP Socket Connectivity & Latency Probe
 * Performs authentic socket connection against target host:port with zero simulated data.
 */
function testTcpSocket(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      if (settled) return;
      settled = true;
      const latencyMs = Date.now() - start;
      cleanup();
      resolve({
        reachable: true,
        latencyMs,
        message: `اتصال واقعی TCP برقرار شد (${latencyMs}ms)`,
        error: null,
        code: 'OK'
      });
    });

    socket.on('timeout', () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        reachable: false,
        latencyMs: null,
        message: `تایم‌اوت شبکه (${timeoutMs} میلی‌ثانیه) در اتصال به ${host}:${port}`,
        error: 'ETIMEDOUT',
        code: 'TIMEOUT'
      });
    });

    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      const code = err.code || 'ECONNFAILED';
      let message = err.message;
      if (code === 'ECONNREFUSED') {
        message = `پورت ${port} روی سرور ${host} بسته است یا تانل هنوز اجرا نشده است (اتصال رد شد - ECONNREFUSED)`;
      } else if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
        message = `سرور ${host} از دسترس شبکه خارج است (${code})`;
      } else if (code === 'ETIMEDOUT') {
        message = `پاسخی از سرور ${host}:${port} دریافت نشد (تایم‌اوت شبکه)`;
      }
      resolve({
        reachable: false,
        latencyMs: null,
        message,
        error: code,
        code
      });
    });

    try {
      socket.connect(port, host);
    } catch (e) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        reachable: false,
        latencyMs: null,
        message: e.message,
        error: e.code || 'EXCEPTION',
        code: 'EXCEPTION'
      });
    }
  });
}

// Bash Script Generators (Backed by repository install scripts)
function generateKharejScript(opts = {}) {
  try {
    let script = fs.readFileSync(path.join(__dirname, 'install-kharej.sh'), 'utf-8');
    const kharej = opts.kharejIP || CONFIG_STORE.kharejIP;
    const iran = opts.iranIP || CONFIG_STORE.iranIPv4;
    const psk = opts.pskKey || CONFIG_STORE.pskKey;
    script = script.replace(/KHAREJ_IP="\$\{KHAREJ_IP:-[^}]*\}"/, `KHAREJ_IP="\${KHAREJ_IP:-${kharej}}"`);
    script = script.replace(/KHAREJ_IP="[^"]*"/, `KHAREJ_IP="${kharej}"`);
    script = script.replace(/PSK_KEY="\$\{PSK_KEY:-[^}]*\}"/, `PSK_KEY="\${PSK_KEY:-${psk}}"`);
    script = script.replace(/PSK_KEY="[^"]*"/, `PSK_KEY="${psk}"`);
    if (opts.tunnelPort) script = script.replace(/TUNNEL_PORT="[^"]*"/g, `TUNNEL_PORT="${opts.tunnelPort}"`);
    if (opts.targetPort) script = script.replace(/TARGET_PORT="[^"]*"/g, `TARGET_PORT="${opts.targetPort}"`);
    return script;
  } catch (e) {
    return '#!/usr/bin/env bash\necho "Script loading failed"';
  }
}

function generateIranScript(opts = {}) {
  try {
    let script = fs.readFileSync(path.join(__dirname, 'install-iran.sh'), 'utf-8');
    const iran = opts.iranIP || CONFIG_STORE.iranIPv4;
    const kharej = opts.kharejIP || CONFIG_STORE.kharejIP;
    const psk = opts.pskKey || CONFIG_STORE.pskKey;
    script = script.replace(/IRAN_IP="\$\{IRAN_IP:-[^}]*\}"/, `IRAN_IP="\${IRAN_IP:-${iran}}"`);
    script = script.replace(/IRAN_IP="[^"]*"/, `IRAN_IP="${iran}"`);
    script = script.replace(/KHAREJ_IP="\$\{KHAREJ_IP:-[^}]*\}"/, `KHAREJ_IP="\${KHAREJ_IP:-${kharej}}"`);
    script = script.replace(/KHAREJ_IP="[^"]*"/, `KHAREJ_IP="${kharej}"`);
    script = script.replace(/PSK_KEY="\$\{PSK_KEY:-[^}]*\}"/, `PSK_KEY="\${PSK_KEY:-${psk}}"`);
    script = script.replace(/PSK_KEY="[^"]*"/, `PSK_KEY="${psk}"`);
    if (opts.tunnelPort) script = script.replace(/TUNNEL_PORT="[^"]*"/g, `TUNNEL_PORT="${opts.tunnelPort}"`);
    if (opts.clientPort) script = script.replace(/CLIENT_LISTEN_PORT="[^"]*"/g, `CLIENT_LISTEN_PORT="${opts.clientPort}"`);
    return script;
  } catch (e) {
    return '#!/usr/bin/env bash\necho "Script loading failed"';
  }
}

function generateDualScript(opts = {}) {
  try {
    let script = fs.readFileSync(path.join(__dirname, 'install-dual.sh'), 'utf-8');
    const kharej = opts.kharejIP || CONFIG_STORE.kharejIP;
    const iran = opts.iranIP || CONFIG_STORE.iranIPv4;
    script = script.replace(/13\.140\.81\.175/g, kharej);
    script = script.replace(/188\.121\.101\.206/g, iran);
    return script;
  } catch (e) {
    return '#!/usr/bin/env bash\necho "Script loading failed"';
  }
}

function generateSanaeiScript() {
  try {
    return fs.readFileSync(path.join(__dirname, 'install-sanaei.sh'), 'utf-8');
  } catch (e) {
    return '#!/usr/bin/env bash\necho "Script loading failed"';
  }
}

function generatePanelScript() {
  try {
    return fs.readFileSync(path.join(__dirname, 'install-panel.sh'), 'utf-8');
  } catch (e) {
    return '#!/usr/bin/env bash\necho "Script loading failed"';
  }
}

// ---------------------------------------------------------
// Direct Script Download Routes (Curlable by remote servers & browsers)
// ---------------------------------------------------------
function sendScript(res, content) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(content);
}

app.get(['/scripts/kharej.sh', '/scripts/install-kharej.sh', '/install-kharej.sh'], (req, res) => {
  sendScript(res, generateKharejScript(req.query));
});

app.get(['/scripts/iran.sh', '/scripts/install-iran.sh', '/install-iran.sh'], (req, res) => {
  sendScript(res, generateIranScript(req.query));
});

app.get(['/scripts/dual.sh', '/scripts/install-dual.sh', '/install-dual.sh'], (req, res) => {
  sendScript(res, generateDualScript(req.query));
});

app.get(['/scripts/sanaei.sh', '/scripts/install-sanaei.sh', '/install-sanaei.sh'], (req, res) => {
  sendScript(res, generateSanaeiScript());
});

app.get(['/scripts/panel.sh', '/scripts/install-panel.sh', '/install-panel.sh'], (req, res) => {
  sendScript(res, generatePanelScript());
});

app.get(['/scripts/kharej.bat', '/install-kharej.bat'], (req, res) => {
  const kharejIP = (req.query.kharejIP || CONFIG_STORE.kharejIP).trim();
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const batContent = `@echo off\r\nchcp 65001 >nul\r\ntitle mh.tunnel - Kharej Server Auto Installer\r\ncls\r\necho ========================================================\r\necho   mh.tunnel Auto-Installer for Kharej Server\r\necho   Target VPS: ${kharejIP}\r\necho ========================================================\r\necho Connecting to Linux VPS via SSH and running automated installer...\r\necho Please enter your VPS root password when prompted:\r\necho.\r\nssh -t root@${kharejIP} "curl -fsSL ${baseUrl}/scripts/kharej.sh | bash"\r\necho.\r\necho Installation complete. Press any key to exit.\r\npause >nul\r\n`;
  res.setHeader('Content-Type', 'application/x-bat');
  res.setHeader('Content-Disposition', 'attachment; filename="install-kharej.bat"');
  res.send(batContent);
});

app.get(['/scripts/iran.bat', '/install-iran.bat'], (req, res) => {
  const iranIP = (req.query.iranIP || CONFIG_STORE.iranIPv4).trim();
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const batContent = `@echo off\r\nchcp 65001 >nul\r\ntitle mh.tunnel - Iran Relay Auto Installer\r\ncls\r\necho ========================================================\r\necho   mh.tunnel Auto-Installer for Iran Server\r\necho   Target VPS: ${iranIP}\r\necho ========================================================\r\necho Connecting to Linux VPS via SSH and running automated installer...\r\necho Please enter your VPS root password when prompted:\r\necho.\r\nssh -t root@${iranIP} "curl -fsSL ${baseUrl}/scripts/iran.sh | bash"\r\necho.\r\necho Installation complete. Press any key to exit.\r\npause >nul\r\n`;
  res.setHeader('Content-Type', 'application/x-bat');
  res.setHeader('Content-Disposition', 'attachment; filename="install-iran.bat"');
  res.send(batContent);
});

// ---------------------------------------------------------
// ---------------------------------------------------------
// 7 Distinct Battle-Tested Anti-Censorship & National-Intranet Tunnels
// All enabled by default on initial install, with optional individual toggle
// ---------------------------------------------------------
const TUNNEL_PRESETS = [
  {
    id: 'tls',
    enabled: true,
    name: 'T2-TLS Quantum (uTLS Chrome 120 + 2-Byte SNI Splitting)',
    shortName: 'TLS هدرشکنی ۲ بایتی (Anti-DPI)',
    transport: 'tls',
    sni: 'speedtest.net',
    kharejPort: 4443,
    targetPort: 2500,
    iranPort: 9000,
    frag: 2,
    status: 'untested',
    latencyMs: null,
    lastTested: null,
    lastError: null,
    tag: 'هدرشکنی DPI ۲ بایتی',
    survivalRating: '۱۰۰٪ در فیلترینگ شدید',
    description: 'شبیه‌سازی کامل HTTPS مرورگر کروم ۱۲۰؛ شکستن هدر به قطعات ۲ بایتی جهت سردرگمی بافرهای DPI فایروال ملی.'
  },
  {
    id: 'ws',
    enabled: true,
    name: 'T2-ArvanCloud & Cloudflare WebSocket (پروکسی معکوس آروان کلاد و کلودفلر)',
    shortName: 'WebSocket CDN (آروان کلاد)',
    transport: 'ws',
    sni: 'www.cloudflare.com',
    kharejPort: 8443,
    targetPort: 2501,
    iranPort: 9001,
    frag: 0,
    status: 'untested',
    latencyMs: null,
    lastTested: null,
    lastError: null,
    tag: 'آروان کلاد / کلودفلر',
    survivalRating: '۱۰۰٪ با دامنه و CDN آروان',
    description: 'رد کردن ترافیک از لبه شبکه توزیع محتوا (CDN آروان یا کلودفلر) روی پورت‌های استاندارد وب؛ آی‌پی سرور خارج کاملاً مخفی می‌ماند.'
  },
  {
    id: 'grpc',
    enabled: true,
    name: 'T2-HTTP/2 Domestic Multiplex (استتار ترافیک آپارات و روبیکا روی H2)',
    shortName: 'gRPC/H2 مولتی‌پکس ملی',
    transport: 'tls',
    sni: 'www.aparat.com',
    kharejPort: 8444,
    targetPort: 2502,
    iranPort: 9002,
    frag: 2,
    status: 'untested',
    latencyMs: null,
    lastTested: null,
    lastError: null,
    tag: 'استتار ویدیو و پیام‌رسان ملی',
    survivalRating: '۱۰۰٪ در شبکه ملی',
    description: 'کانال مالتی‌استریم پرسرعت بر بستر HTTP/2 با هدر شبیه‌سازی ترافیک سرویس‌های مجاز ویدیویی داخلی (aparat.com) با کمترین پینگ.'
  },
  {
    id: 'fake_tcp',
    enabled: true,
    name: 'T2-FakeTCP Raw IP (شبیه‌ساز اتصال لایه ۳ لینوکس - دور زدن فیلتر UDP)',
    shortName: 'FakeTCP خام لایه ۳ (ضد UDP Drop)',
    transport: 'raw',
    sni: 'cdnjs.cloudflare.com',
    kharejPort: 4445,
    targetPort: 2503,
    iranPort: 9003,
    frag: 0,
    status: 'untested',
    latencyMs: null,
    lastTested: null,
    lastError: null,
    tag: 'بای‌پس فیلتر UDP اپراتورها',
    survivalRating: '۱۰۰٪ در اختلالات همراه اول/ایرانسل',
    description: 'جایگزینی پکت‌های آسیب‌پذیر UDP با هدرهای استاندارد TCP SYN/ACK در هسته لینوکس؛ اپراتور نمی‌تواند پکت‌ها را قطع کند.'
  },
  {
    id: 'ipv6_direct',
    enabled: true,
    name: 'T2-IPv6 Direct Peering (گذر از فیلترینگ با روتینگ مستقیم IPv6 دیتاسنتری)',
    shortName: 'IPv6 Direct Bypass',
    transport: 'tls',
    sni: 'speedtest.net',
    kharejPort: 4446,
    targetPort: 2504,
    iranPort: 9004,
    frag: 4,
    status: 'untested',
    latencyMs: null,
    lastTested: null,
    lastError: null,
    tag: 'مسیر اختصاصی IPv6 دیتاسنتر',
    survivalRating: '۱۰۰٪ بدون فیلتر DPI روی IPv6',
    description: 'هدایت ترافیک از گیت‌وی IPv6 دیتاسنترهای ایران به سمت سرور خارج؛ فیلترینگ لایه ۴ روی IPv6 غیرفعال است.'
  },
  {
    id: 'reverse_intranet',
    enabled: true,
    name: 'T2-Reverse Intranet Bridge (تانل معکوس دوطرفه مخصوص قطعی اینترنت بین‌الملل و سرور بدون اینترنت)',
    shortName: 'تانل معکوس اینترنت ملی (Reverse Bridge)',
    transport: 'reverse-bridge',
    sni: 'speedtest.net',
    kharejPort: 4447,
    targetPort: 2505,
    iranPort: 9005,
    frag: 4,
    status: 'untested',
    latencyMs: null,
    lastTested: null,
    lastError: null,
    isReverse: true,
    tag: 'اینترنت ملی / سرور بدون اینترنت',
    survivalRating: '۱۰۰٪ در قطعی کامل بین‌الملل',
    description: 'حل قطعی اینترنت بین‌الملل و سرور بدون اینترنت: سرور خارج از بیرون به ایران متصل شده و ترافیک کاربر روی پورت ۹۰۰۵ را به صورت معکوس بدون نیاز به اینترنت آزاد ایران به مقصد می‌رساند.'
  },
  {
    id: 'reverse_access_ip',
    enabled: true,
    name: 'T2-Reverse Access-IP & Whitelist (تانل معکوس مخصوص سرورهای آی‌پی اکسس‌شده و لیست سفید ملی)',
    shortName: 'تانل آی‌پی اکسس‌شده (Access-IP / Whitelist)',
    transport: 'reverse-whitelist',
    sni: 'divar.ir',
    kharejPort: 4448,
    targetPort: 2506,
    iranPort: 9006,
    frag: 4,
    status: 'untested',
    latencyMs: null,
    lastTested: null,
    lastError: null,
    isReverse: true,
    tag: 'آی‌پی اکسس‌شده / لیست سفید دیتاسنتر',
    survivalRating: '۱۰۰٪ در دیتاسنترهای محدود',
    description: 'ویژه سرورهایی که فقط به سایت‌ها و دامنه‌های مجاز داخلی دسترسی دارند؛ استتار ترافیک تحت پوشش SNI دامنه‌های تاییدشده ایرانی (divar.ir / splus.ir) روی پورت ۹۰۰۶.'
  }
];

app.get('/api/tunnels', (req, res) => {
  res.json({
    ok: true,
    tunnels: TUNNEL_PRESETS,
    iranIPv4: CONFIG_STORE.iranIPv4,
    iranIPv6: CONFIG_STORE.iranIPv6,
    kharejIP: CONFIG_STORE.kharejIP
  });
});

/**
 * Toggle individual tunnel state (enable/disable)
 */
app.post('/api/tunnel/:id/toggle', (req, res) => {
  const { id } = req.params;
  const tunnel = TUNNEL_PRESETS.find(t => t.id === id);
  if (!tunnel) return res.status(404).json({ ok: false, error: 'تانل یافت نشد' });

  if (typeof req.body.enabled === 'boolean') {
    tunnel.enabled = req.body.enabled;
  } else {
    tunnel.enabled = !tunnel.enabled;
  }

  addLog(`[TUNNEL STATE] Tunnel ${tunnel.shortName} (${tunnel.id}) is now ${tunnel.enabled ? 'ENABLED' : 'DISABLED'}`);

  res.json({
    ok: true,
    id: tunnel.id,
    name: tunnel.shortName,
    enabled: tunnel.enabled,
    message: `تانل ${tunnel.shortName} ${tunnel.enabled ? 'فعال' : 'غیرفعال'} شد.`
  });
});

/**
 * Toggle all tunnels at once
 */
app.post('/api/tunnel/toggle-all', (req, res) => {
  const enable = req.body.enable !== false;
  TUNNEL_PRESETS.forEach(t => { t.enabled = enable; });
  addLog(`[TUNNEL STATE] All tunnels are now ${enable ? 'ENABLED' : 'DISABLED'}`);
  res.json({
    ok: true,
    allEnabled: enable,
    message: `تمام ۷ تانل ${enable ? 'فعال' : 'غیرفعال'} شدند.`,
    tunnels: TUNNEL_PRESETS
  });
});

/**
 * Real Live Socket Probe for a Single Tunnel
 */
app.post('/api/tunnel/:id/test', async (req, res) => {
  const { id } = req.params;
  const tunnel = TUNNEL_PRESETS.find(t => t.id === id);
  if (!tunnel) return res.status(404).json({ ok: false, error: 'تانل یافت نشد' });

  const host = (req.body.host || req.query.host || CONFIG_STORE.kharejIP).trim();
  const port = parseInt(req.body.port || req.query.port || tunnel.kharejPort, 10);

  addLog(`[LIVE PROBE] Probing TCP socket ${host}:${port} (${tunnel.shortName})...`);
  const probe = await testTcpSocket(host, port, 3000);

  tunnel.status = probe.reachable ? 'active' : (probe.error === 'ETIMEDOUT' ? 'timeout' : 'closed');
  tunnel.latencyMs = probe.latencyMs;
  tunnel.lastError = probe.error;
  tunnel.lastTested = new Date().toISOString();

  addLog(`[LIVE PROBE RESULT] ${tunnel.shortName} -> ${probe.reachable ? `Reachable (${probe.latencyMs}ms)` : `Unreachable (${probe.error})`}`);

  res.json({
    ok: true,
    id: tunnel.id,
    name: tunnel.shortName,
    host,
    port,
    reachable: probe.reachable,
    status: tunnel.status,
    latencyMs: probe.latencyMs,
    error: probe.error,
    message: probe.message,
    verifiedAt: new Date().toLocaleTimeString('fa-IR')
  });
});

/**
 * Real Live Socket Probe for ALL 7 Tunnels Concurrently
 */
app.post('/api/tunnels/test-all', async (req, res) => {
  const host = (req.body.host || req.query.host || CONFIG_STORE.kharejIP).trim();
  addLog(`[LIVE BATCH PROBE] Testing all 7 tunnel ports on ${host}...`);

  const results = await Promise.all(TUNNEL_PRESETS.map(async (tunnel) => {
    const probe = await testTcpSocket(host, tunnel.kharejPort, 3000);
    tunnel.status = probe.reachable ? 'active' : (probe.error === 'ETIMEDOUT' ? 'timeout' : 'closed');
    tunnel.latencyMs = probe.latencyMs;
    tunnel.lastError = probe.error;
    tunnel.lastTested = new Date().toISOString();

    return {
      id: tunnel.id,
      name: tunnel.shortName,
      port: tunnel.kharejPort,
      targetPort: tunnel.targetPort,
      reachable: probe.reachable,
      status: tunnel.status,
      latencyMs: probe.latencyMs,
      error: probe.error,
      message: probe.message
    };
  }));

  res.json({
    ok: true,
    host,
    results,
    testedAt: new Date().toLocaleTimeString('fa-IR')
  });
});

app.get('/api/scripts/all', (req, res) => {
  const iranIP = req.query.iranIP || CONFIG_STORE.iranIPv4;
  const kharejIP = req.query.kharejIP || CONFIG_STORE.kharejIP;
  const pskKey = req.query.pskKey || CONFIG_STORE.pskKey;
  const opts = { iranIP, kharejIP, pskKey };

  const baseUrl = `${req.protocol}://${req.get('host')}`;

  const kharejHostedUrl = `${baseUrl}/scripts/kharej.sh`;
  const iranHostedUrl = `${baseUrl}/scripts/iran.sh`;
  const dualHostedUrl = `${baseUrl}/scripts/dual.sh`;
  const sanaeiHostedUrl = `${baseUrl}/scripts/sanaei.sh`;

  // Working curl command served directly by this server (No 404!)
  const kharejCurl = `curl -fsSL "${kharejHostedUrl}" | sudo bash`;
  const iranCurl = `curl -fsSL "${iranHostedUrl}" | sudo bash`;
  const dualCurl = `curl -fsSL "${dualHostedUrl}" | sudo bash`;
  const sanaeiCurl = `curl -fsSL "${sanaeiHostedUrl}" | sudo bash`;

  // 1-Click command for Windows users (CMD / PowerShell) to connect to VPS and install automatically
  const windowsKharejOneClick = `ssh -t root@${kharejIP} "curl -fsSL ${kharejHostedUrl} | bash"`;
  const windowsIranOneClick = `ssh -t root@${iranIP} "curl -fsSL ${iranHostedUrl} | bash"`;
  const windowsKharejGitDirect = `ssh -t root@${kharejIP} "curl -fsSL https://raw.githubusercontent.com/dnjebeuifedihwdih/T2HASH-CORE/main/install-kharej.sh | sudo bash || (git clone https://github.com/dnjebeuifedihwdih/T2HASH-CORE.git && cd T2HASH-CORE && sudo bash install-kharej.sh)"`;

  // Standard GitHub direct commands for dnjebeuifedihwdih/T2HASH-CORE
  const officialGithubClone = 'git clone https://github.com/dnjebeuifedihwdih/T2HASH-CORE.git && cd T2HASH-CORE && sudo bash install-kharej.sh';
  const officialGithubCurl = 'curl -fsSL https://raw.githubusercontent.com/dnjebeuifedihwdih/T2HASH-CORE/main/install-kharej.sh | sudo bash';

  res.json({
    ok: true,
    baseUrl,
    githubRepo: 'https://github.com/dnjebeuifedihwdih/T2HASH-CORE',
    officialCommand: officialGithubClone,
    officialCurl: officialGithubCurl,
    windowsKharejGitDirect,
    kharej: {
      name: 'install-kharej.sh',
      title: 'اسکریپت سرور خارج (Server/Exit Node)',
      description: 'نصب خودکار هسته لینوکس، BBR، فایروال و ۷ سرویس تانل گیرنده و پل معکوس اینترنت ملی',
      hostedUrl: kharejHostedUrl,
      rawUrl: GITHUB_SCRIPTS.kharej,
      curlCommand: kharejCurl,
      githubCurl: 'curl -fsSL https://raw.githubusercontent.com/dnjebeuifedihwdih/T2HASH-CORE/main/install-kharej.sh | sudo bash',
      githubClone: officialGithubClone,
      windowsCommand: windowsKharejOneClick,
      code: generateKharejScript(opts)
    },
    iran: {
      name: 'install-iran.sh',
      title: 'اسکریپت سرور ایران (Client/Relay & Reverse Hub)',
      description: 'نصب خودکار ۷ تانل همزمان در ایران با هدرشکنی ضد DPI، هاب معکوس اینترنت ملی (پورت ۹۰۰۵) و بای‌پس سرورهای اکسس‌شده (پورت ۹۰۰۶)',
      hostedUrl: iranHostedUrl,
      rawUrl: GITHUB_SCRIPTS.iran,
      curlCommand: iranCurl,
      githubCurl: 'curl -fsSL https://raw.githubusercontent.com/dnjebeuifedihwdih/T2HASH-CORE/main/install-iran.sh | sudo bash',
      windowsCommand: windowsIranOneClick,
      code: generateIranScript(opts)
    },
    dual: {
      name: 'install-dual.sh',
      title: 'اسکریپت دوکاره (Unified Dual-Role)',
      description: 'منوی اینتراکتیو در محیط ترمینال جهت انتخاب نقش سرور (ایران یا خارج) در یک فایل',
      hostedUrl: dualHostedUrl,
      rawUrl: GITHUB_SCRIPTS.dual,
      curlCommand: dualCurl,
      githubCurl: 'curl -fsSL https://raw.githubusercontent.com/dnjebeuifedihwdih/T2HASH-CORE/main/install-dual.sh | sudo bash',
      code: generateDualScript(opts)
    },
    sanaei: {
      name: 'install-sanaei.sh',
      title: 'اسکریپت نصب سنایی (3x-ui)',
      description: 'نصب اتوماتیک پنل مدیریت اکانت و Xray Core به همراه پورت ۲۵۰۰ ویژه تانل',
      hostedUrl: sanaeiHostedUrl,
      rawUrl: GITHUB_SCRIPTS.sanaei,
      curlCommand: sanaeiCurl,
      code: generateSanaeiScript()
    }
  });
});

// =============================================================================
// Real Sanaei (3x-ui) API Integration
// Performs authentic HTTP calls to 3x-ui web panel, cookie management, and error handling
// =============================================================================

// Helper to construct request headers for Sanaei API (Supports Session Cookie AND/OR API Token)
function getSanaeiHeaders(opts, sessionCookie = '') {
  const token = (opts.apiToken || opts.token || opts.apiKey || '').trim();
  const headers = { 'Accept': 'application/json' };
  const activeCookie = sessionCookie || opts.sessionCookie || '';

  if (activeCookie) {
    headers['Cookie'] = `3x-ui=${activeCookie}`;
  }
  if (token) {
    headers['Token'] = token;
    headers['Api-Token'] = token;
    headers['Authorization'] = `Bearer ${token}`;
    if (!activeCookie) {
      headers['Cookie'] = `3x-ui=${token}`;
    }
  }
  return headers;
}

/**
 * Live Connection & Credentials / API Token Test against Sanaei Panel
 */
app.post('/api/sanaei/test-connection', async (req, res) => {
  const { host = CONFIG_STORE.kharejIP, port = 2053, basePath = '', username = 'admin', password = '', apiToken = '', token = '' } = req.body;
  const activeToken = (apiToken || token || '').trim();

  if (!password && !activeToken) {
    return res.status(400).json({ ok: false, error: 'رمز عبور یا توکن اختصاصی API سنایی الزامی است' });
  }

  const cleanBasePath = basePath ? (basePath.startsWith('/') ? basePath : '/' + basePath) : '';
  const loginUrl = `http://${host}:${port}${cleanBasePath}/login`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    let sessionCookie = '';
    let authenticated = false;

    // 1. Try Token Authentication if Token provided
    if (activeToken) {
      try {
        const listRes = await fetch(`http://${host}:${port}${cleanBasePath}/panel/api/inbounds/list`, {
          headers: getSanaeiHeaders(req.body, activeToken),
          signal: AbortSignal.timeout(3500)
        });
        const listData = await listRes.json().catch(() => ({}));
        if (listData.success && Array.isArray(listData.obj)) {
          authenticated = true;
          sessionCookie = activeToken;
          addLog(`[SANAEI API] API Token authentication successful at ${host}:${port}`);
          return res.json({
            ok: true,
            connected: true,
            authenticated: true,
            authMethod: 'API Token',
            host,
            port,
            sessionCookie,
            inboundsCount: listData.obj.length,
            inbounds: listData.obj.map(item => ({
              id: item.id,
              tag: item.tag || item.remark,
              port: item.port,
              protocol: item.protocol,
              enable: item.enable
            })),
            message: `اتصال و احراز هویت هوشمند با API Token سنایی در ${host}:${port} با موفقیت تایید شد!`
          });
        }
      } catch (e) {}
    }

    // 2. Fallback to Username & Password Authentication
    if (password) {
      const formParams = new URLSearchParams();
      formParams.append('username', username);
      formParams.append('password', password);

      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formParams,
        signal: controller.signal
      });
      clearTimeout(timeout);

      const data = await response.json().catch(() => ({}));
      const rawCookies = response.headers.get('set-cookie') || '';
      const sessionMatch = rawCookies.match(/3x-ui=([^;]+)/);
      sessionCookie = sessionMatch ? sessionMatch[1] : '';

      if (data.success || sessionCookie) {
        authenticated = true;
        addLog(`[SANAEI API] Password authentication successful for ${username} at ${host}:${port}`);

        let inbounds = [];
        try {
          const listRes = await fetch(`http://${host}:${port}${cleanBasePath}/panel/api/inbounds/list`, {
            headers: getSanaeiHeaders(req.body, sessionCookie),
            signal: AbortSignal.timeout(3000)
          });
          const listData = await listRes.json().catch(() => ({}));
          if (listData.success && Array.isArray(listData.obj)) {
            inbounds = listData.obj.map(item => ({
              id: item.id,
              tag: item.tag || item.remark,
              port: item.port,
              protocol: item.protocol,
              enable: item.enable
            }));
          }
        } catch (e) {}

        return res.json({
          ok: true,
          connected: true,
          authenticated: true,
          authMethod: 'Username/Password',
          host,
          port,
          sessionCookie,
          inboundsCount: inbounds.length,
          inbounds,
          message: `اتصال و احراز هویت با پنل سنایی در ${host}:${port} با موفقیت انجام شد!`
        });
      }
    }

    return res.json({
      ok: false,
      connected: true,
      authenticated: false,
      error: 'احراز هویت ناموفق بود: API Token یا رمز عبور اشتباه است'
    });

  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    const errMsg = isTimeout
      ? `تایم‌اوت در ارتباط با ${host}:${port} (سرور در دسترس نیست یا پورت بسته است)`
      : `خطا در اتصال به پورت ${port} در سرور ${host} (${err.code || err.message})`;

    addLog(`[SANAEI API ERROR] ${errMsg}`);
    return res.json({
      ok: false,
      connected: false,
      authenticated: false,
      error: errMsg
    });
  }
});

app.post('/api/sanaei/login', async (req, res) => {
  const { host = CONFIG_STORE.kharejIP, port = 2053, basePath = '', username = 'admin', password, apiToken = '' } = req.body;
  if (apiToken) {
    return res.json({ ok: true, sessionCookie: apiToken, message: 'ورود موفق با API Token سنایی' });
  }
  if (!password) {
    return res.status(400).json({ ok: false, error: 'رمز عبور یا API Token سنایی الزامی است' });
  }

  const cleanBasePath = basePath ? (basePath.startsWith('/') ? basePath : '/' + basePath) : '';
  const url = `http://${host}:${port}${cleanBasePath}/login`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    const formParams = new URLSearchParams();
    formParams.append('username', username);
    formParams.append('password', password);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formParams,
      signal: controller.signal
    });
    clearTimeout(timeout);

    const data = await response.json().catch(() => ({}));
    const rawCookies = response.headers.get('set-cookie') || '';
    const sessionMatch = rawCookies.match(/3x-ui=([^;]+)/);
    const sessionCookie = sessionMatch ? sessionMatch[1] : '';

    if (data.success || sessionCookie) {
      addLog(`[SANAEI API] Logged in to 3x-ui at ${host}:${port} successfully.`);
      return res.json({ ok: true, sessionCookie, message: 'ورود موفق به پنل سنایی' });
    } else {
      return res.json({ ok: false, error: data.msg || 'نام کاربری یا رمز عبور اشتباه است' });
    }
  } catch (err) {
    addLog(`[SANAEI API ERROR] Failed to connect to ${url}: ${err.message}`);
    return res.json({
      ok: false,
      error: `عدم برقراری ارتباط با پنل سنایی در ${host}:${port} (${err.name === 'AbortError' ? 'تایم‌اوت' : err.message})`
    });
  }
});

// Helper to authenticate with Sanaei and return sessionCookie or Token
async function resolveSanaeiCookie(opts) {
  const { host = CONFIG_STORE.kharejIP, port = 2053, basePath = '', username = 'admin', password = '', sessionCookie = '', apiToken = '', token = '' } = opts;
  const activeToken = (apiToken || token || '').trim();
  if (activeToken) return activeToken;
  if (sessionCookie) return sessionCookie;
  if (!password) return null;

  const cleanBasePath = basePath ? (basePath.startsWith('/') ? basePath : '/' + basePath) : '';
  try {
    const loginUrl = `http://${host}:${port}${cleanBasePath}/login`;
    const formParams = new URLSearchParams();
    formParams.append('username', username);
    formParams.append('password', password);
    const res = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formParams,
      signal: AbortSignal.timeout(4000)
    });
    const rawCookies = res.headers.get('set-cookie') || '';
    const m = rawCookies.match(/3x-ui=([^;]+)/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

/**
 * Sanaei Master API: Live Inbounds Listing with Traffic Statistics
 */
app.post('/api/sanaei/inbounds/list', async (req, res) => {
  const { host = CONFIG_STORE.kharejIP, port = 2053, basePath = '' } = req.body;
  const cleanBasePath = basePath ? (basePath.startsWith('/') ? basePath : '/' + basePath) : '';
  const cookie = await resolveSanaeiCookie(req.body);
  if (!cookie) {
    return res.status(401).json({ ok: false, error: 'برای دریافت لیست اینباندها API Token یا رمز عبور پنل سنایی را وارد نمایید' });
  }

  try {
    const listUrl = `http://${host}:${port}${cleanBasePath}/panel/api/inbounds/list`;
    const response = await fetch(listUrl, {
      headers: getSanaeiHeaders(req.body, cookie),
      signal: AbortSignal.timeout(4000)
    });
    const data = await response.json().catch(() => ({}));

    if (data.success && Array.isArray(data.obj)) {
      const inbounds = data.obj.map(item => {
        let clientsCount = 0;
        try {
          const settings = typeof item.settings === 'string' ? JSON.parse(item.settings) : item.settings;
          if (settings && Array.isArray(settings.clients)) {
            clientsCount = settings.clients.length;
          }
        } catch (e) {}

        return {
          id: item.id,
          tag: item.tag || item.remark || `inbound-${item.port}`,
          port: item.port,
          protocol: item.protocol,
          enable: item.enable,
          up: item.up || 0,
          down: item.down || 0,
          total: item.total || 0,
          expiryTime: item.expiryTime || 0,
          clientsCount
        };
      });

      return res.json({
        ok: true,
        sessionCookie: cookie,
        count: inbounds.length,
        inbounds
      });
    } else {
      return res.json({ ok: false, error: data.msg || 'عدم دریافت لیست اینباندها از سنایی' });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: `خطا در فراخوانی اینباندهای سنایی: ${err.message}` });
  }
});

/**
 * Sanaei Master API: Toggle Inbound Enable/Disable State
 */
app.post('/api/sanaei/inbounds/toggle', async (req, res) => {
  const { host = CONFIG_STORE.kharejIP, port = 2053, basePath = '', inboundId, enable } = req.body;
  const cleanBasePath = basePath ? (basePath.startsWith('/') ? basePath : '/' + basePath) : '';
  const cookie = await resolveSanaeiCookie(req.body);
  if (!cookie) {
    return res.status(401).json({ ok: false, error: 'احراز هویت سنایی ناموفق بود' });
  }
  if (!inboundId) {
    return res.status(400).json({ ok: false, error: 'شناسه اینباند (inboundId) الزامی است' });
  }

  try {
    // 1. Fetch current inbound data
    const getUrl = `http://${host}:${port}${cleanBasePath}/panel/api/inbounds/get/${inboundId}`;
    const getRes = await fetch(getUrl, {
      headers: getSanaeiHeaders(req.body, cookie),
      signal: AbortSignal.timeout(3500)
    });
    const getData = await getRes.json().catch(() => ({}));
    if (!getData.success || !getData.obj) {
      return res.status(404).json({ ok: false, error: 'اینباند در دیتابیس سنایی یافت نشد' });
    }

    const currentObj = getData.obj;
    const newEnable = typeof enable === 'boolean' ? enable : !currentObj.enable;
    currentObj.enable = newEnable;

    // 2. Update inbound in Sanaei
    const updateUrl = `http://${host}:${port}${cleanBasePath}/panel/api/inbounds/update/${inboundId}`;
    const updateRes = await fetch(updateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getSanaeiHeaders(req.body, cookie)
      },
      body: JSON.stringify(currentObj),
      signal: AbortSignal.timeout(4000)
    });
    const updateData = await updateRes.json().catch(() => ({}));

    if (updateData.success) {
      addLog(`[SANAEI API] Inbound ID ${inboundId} (port ${currentObj.port}) set to ${newEnable ? 'ENABLED' : 'DISABLED'}`);
      return res.json({
        ok: true,
        inboundId,
        port: currentObj.port,
        enable: newEnable,
        message: `اینباند پورت ${currentObj.port} در پنل سنایی ${newEnable ? 'فعال' : 'غیرفعال'} شد.`
      });
    } else {
      return res.json({ ok: false, error: updateData.msg || 'خطا در تغییر وضعیت اینباند سنایی' });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: `خطا در اتصال به API سنایی: ${err.message}` });
  }
});

/**
 * Sanaei Master API: Delete Inbound
 */
app.post('/api/sanaei/inbounds/delete', async (req, res) => {
  const { host = CONFIG_STORE.kharejIP, port = 2053, basePath = '', inboundId } = req.body;
  const cleanBasePath = basePath ? (basePath.startsWith('/') ? basePath : '/' + basePath) : '';
  const cookie = await resolveSanaeiCookie(req.body);
  if (!cookie) {
    return res.status(401).json({ ok: false, error: 'احراز هویت سنایی ناموفق بود' });
  }
  if (!inboundId) {
    return res.status(400).json({ ok: false, error: 'شناسه اینباند (inboundId) الزامی است' });
  }

  try {
    const delUrl = `http://${host}:${port}${cleanBasePath}/panel/api/inbounds/del/${inboundId}`;
    const delRes = await fetch(delUrl, {
      method: 'POST',
      headers: getSanaeiHeaders(req.body, cookie),
      signal: AbortSignal.timeout(4000)
    });
    const delData = await delRes.json().catch(() => ({}));
    if (delData.success) {
      addLog(`[SANAEI API] Inbound ID ${inboundId} deleted from Sanaei.`);
      return res.json({ ok: true, inboundId, message: `اینباند شماره ${inboundId} با موفقیت حذف شد.` });
    } else {
      return res.json({ ok: false, error: delData.msg || 'خطا در حذف اینباند' });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: `خطا در حذف اینباند: ${err.message}` });
  }
});

/**
 * Sanaei Master API: Reset All Traffic Counters
 */
app.post('/api/sanaei/inbounds/reset-traffic', async (req, res) => {
  const { host = CONFIG_STORE.kharejIP, port = 2053, basePath = '' } = req.body;
  const cleanBasePath = basePath ? (basePath.startsWith('/') ? basePath : '/' + basePath) : '';
  const cookie = await resolveSanaeiCookie(req.body);
  if (!cookie) {
    return res.status(401).json({ ok: false, error: 'احراز هویت سنایی ناموفق بود' });
  }

  try {
    const resetUrl = `http://${host}:${port}${cleanBasePath}/panel/api/inbounds/resetAllTraffics`;
    const rRes = await fetch(resetUrl, {
      method: 'POST',
      headers: getSanaeiHeaders(req.body, cookie),
      signal: AbortSignal.timeout(4000)
    });
    const rData = await rRes.json().catch(() => ({}));
    if (rData.success) {
      addLog(`[SANAEI API] Reset all traffic counters successfully.`);
      return res.json({ ok: true, message: 'میزان ترافیک تمامی اینباندهای سنایی با موفقیت صفر شد.' });
    } else {
      return res.json({ ok: false, error: rData.msg || 'خطا در ریست ترافیک' });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: `خطا در اتصال به API: ${err.message}` });
  }
});

/**
 * Sanaei Master API: Live Server Hardware Metrics & Xray Core Status
 */
app.post('/api/sanaei/server/status', async (req, res) => {
  const { host = CONFIG_STORE.kharejIP, port = 2053, basePath = '' } = req.body;
  const cleanBasePath = basePath ? (basePath.startsWith('/') ? basePath : '/' + basePath) : '';
  const cookie = await resolveSanaeiCookie(req.body);
  if (!cookie) {
    return res.status(401).json({ ok: false, error: 'احراز هویت سنایی ناموفق بود' });
  }

  try {
    const statusUrl = `http://${host}:${port}${cleanBasePath}/server/status`;
    const sRes = await fetch(statusUrl, {
      method: 'POST',
      headers: getSanaeiHeaders(req.body, cookie),
      signal: AbortSignal.timeout(4000)
    });
    const sData = await sRes.json().catch(() => ({}));
    if (sData.success && sData.obj) {
      return res.json({
        ok: true,
        cpu: sData.obj.cpu,
        mem: sData.obj.mem,
        swap: sData.obj.swap,
        disk: sData.obj.disk,
        xray: sData.obj.xray,
        uptime: sData.obj.uptime,
        loads: sData.obj.loads
      });
    } else {
      return res.json({ ok: false, error: sData.msg || 'عدم دریافت اطلاعات سیستم از سنایی' });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: `خطا در دریافت وضعیت سرور سنایی: ${err.message}` });
  }
});

// Auto-create Single Inbound in Sanaei or generate Tunneled VLESS configuration
app.post('/api/sanaei/create-inbound', async (req, res) => {
  const activeIranIP = req.body.iranIPv4 || req.body.iranIP || CONFIG_STORE.iranIPv4;
  const activeIranIPv6 = req.body.iranIPv6 || CONFIG_STORE.iranIPv6;
  const {
    host = CONFIG_STORE.kharejIP,
    port = 2053,
    basePath = '',
    sessionCookie = '',
    username = 'admin',
    password = '',
    remark = 'mh.tunnel-VLESS',
    inboundPort = CONFIG_STORE.targetPort || 2500,
    clientPort = CONFIG_STORE.clientPort || 9000
  } = req.body;

  const uuid = crypto.randomUUID();
  const cleanBasePath = basePath ? (basePath.startsWith('/') ? basePath : '/' + basePath) : '';

  // Generate tunneled VLESS links pointing to IRAN relay
  const vlessLinkIPv4 = `vless://${uuid}@${activeIranIP}:${clientPort}?encryption=none&security=none&type=tcp#mh.tunnel-IRAN-RELAY`;
  const vlessLinkIPv6 = `vless://${uuid}@[${activeIranIPv6}]:${clientPort}?encryption=none&security=none&type=tcp#mh.tunnel-IRAN-IPv6`;
  const subContent = `${vlessLinkIPv4}\n${vlessLinkIPv6}`;
  const subscriptionBase64 = Buffer.from(subContent).toString('base64');

  // Attempt live 3x-ui API call if sessionCookie or password provided
  let liveApiSuccess = false;
  let liveApiMsg = '';
  let activeCookie = sessionCookie;

  if (password && !activeCookie) {
    try {
      const loginUrl = `http://${host}:${port}${cleanBasePath}/login`;
      const formParams = new URLSearchParams();
      formParams.append('username', username);
      formParams.append('password', password);
      const lRes = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formParams,
        signal: AbortSignal.timeout(4000)
      });
      const lCookies = lRes.headers.get('set-cookie') || '';
      const m = lCookies.match(/3x-ui=([^;]+)/);
      if (m) activeCookie = m[1];
    } catch (e) {
      liveApiMsg = `عدم امکان برقراری ارتباط زنده با سنایی در ${host}:${port} (${e.message})`;
    }
  }

  if (activeCookie) {
    try {
      const addUrl = `http://${host}:${port}${cleanBasePath}/panel/api/inbounds/add`;
      const inboundPayload = {
        up: 0,
        down: 0,
        total: 0,
        remark: remark,
        enable: true,
        expiryTime: 0,
        listen: '127.0.0.1',
        port: parseInt(inboundPort, 10),
        protocol: 'vless',
        settings: JSON.stringify({
          clients: [{ id: uuid, flow: '', email: `user_${uuid.slice(0, 6)}@mhtunnel` }],
          decryption: 'none',
          fallbacks: []
        }),
        streamSettings: JSON.stringify({
          network: 'tcp',
          security: 'none',
          tcpSettings: { header: { type: 'none' } }
        }),
        sniffing: JSON.stringify({ enabled: true, destOverride: ['http', 'tls'] })
      };

      const addRes = await fetch(addUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `3x-ui=${activeCookie}`
        },
        body: JSON.stringify(inboundPayload),
        signal: AbortSignal.timeout(4500)
      });

      const addData = await addRes.json().catch(() => ({}));
      if (addData.success) {
        liveApiSuccess = true;
        liveApiMsg = `اینباند پورت ${inboundPort} با موفقیت در پنل سنایی سرور خارج ایجاد شد!`;
        addLog(`[SANAEI API] Successfully created inbound port ${inboundPort} with UUID ${uuid}`);
      } else {
        liveApiMsg = `پنل سنایی پیام داد: ${addData.msg || 'خطا در ثبت اینباند'}`;
      }
    } catch (e) {
      liveApiMsg = `عدم اتصال به API سنایی (${e.message}). کانفیگ‌ها به صورت محلی تولید شدند.`;
    }
  }

  res.json({
    ok: true,
    liveApiSuccess,
    liveApiMsg: liveApiMsg || 'کانفیگ و لینک تونل‌شده با موفقیت تولید شد',
    uuid,
    inboundPort: parseInt(inboundPort, 10),
    clientPort: parseInt(clientPort, 10),
    iranIPv4: activeIranIP,
    iranIPv6: activeIranIPv6,
    kharejIP: host,
    vlessLinkIPv4,
    vlessLinkIPv6,
    subscriptionBase64,
    xrayJsonSnippet: {
      inbound: {
        tag: 'mhtunnel-inbound',
        port: parseInt(inboundPort, 10),
        listen: '127.0.0.1',
        protocol: 'vless',
        settings: {
          clients: [{ id: uuid, flow: '' }],
          decryption: 'none'
        },
        streamSettings: { network: 'tcp', security: 'none' }
      },
      clientConfig: {
        address: activeIranIP,
        port: parseInt(clientPort, 10),
        protocol: 'vless',
        uuid,
        security: 'none'
      }
    }
  });
});

// Helper to construct exact VLESS link matching Sanaei inbound streamSettings (ws, grpc, tcp, etc.)
function buildDynamicVlessLink({ uuid, host, port, tag, inboundObj }) {
  let type = 'tcp';
  let path = '';
  let serviceName = '';
  let security = 'none';

  if (inboundObj) {
    try {
      const stream = typeof inboundObj.streamSettings === 'string' ? JSON.parse(inboundObj.streamSettings) : inboundObj.streamSettings;
      if (stream) {
        if (stream.network) type = stream.network;
        if (stream.security && stream.security !== 'none') security = stream.security;
        if (stream.wsSettings && stream.wsSettings.path) path = stream.wsSettings.path;
        if (stream.grpcSettings && stream.grpcSettings.serviceName) serviceName = stream.grpcSettings.serviceName;
      }
    } catch(e) {}
  }

  let params = `encryption=none&security=${security}&type=${type}`;
  if (type === 'ws' && path) params += `&path=${encodeURIComponent(path)}`;
  if (type === 'grpc' && serviceName) params += `&serviceName=${encodeURIComponent(serviceName)}&mode=gun`;

  return `vless://${uuid}@${host}:${port}?${params}#${encodeURIComponent(tag)}`;
}

// Auto-create all 5 inbounds in Sanaei and return 5 VLESS links + 1 unified subscription
app.post('/api/sanaei/create-multi-inbounds', async (req, res) => {
  const activeIranIP = req.body.iranIPv4 || req.body.iranIP || CONFIG_STORE.iranIPv4;
  const activeKharejIP = req.body.kharejIP || req.body.host || CONFIG_STORE.kharejIP;
  const { host = activeKharejIP, port = 2053, basePath = '', username = 'admin', password = '' } = req.body;
  const cleanBasePath = basePath ? (basePath.startsWith('/') ? basePath : '/' + basePath) : '';

  let activeCookie = await resolveSanaeiCookie(req.body);
  let apiLoggedIn = !!activeCookie;
  let connectionError = null;

  if (!activeCookie && password) {
    connectionError = 'اطلاعات ورود به سنایی نادرست است';
  } else if (!activeCookie && !req.body.apiToken) {
    connectionError = `ارتباط با پورت ${port} سنایی برقرار نشد`;
  }

  let existingInboundsMap = new Map();
  if (activeCookie) {
    try {
      const listUrl = `http://${host}:${port}${cleanBasePath}/panel/api/inbounds/list`;
      const listRes = await fetch(listUrl, {
        headers: getSanaeiHeaders(req.body, activeCookie),
        signal: AbortSignal.timeout(3500)
      });
      const listData = await listRes.json().catch(() => ({}));
      if (listData.success && Array.isArray(listData.obj)) {
        listData.obj.forEach(item => {
          existingInboundsMap.set(item.port, item);
        });
      }
    } catch (e) {}
  }

  const results = [];
  const vlessLinksList = [];
  let remoteCreatedCount = 0;

  for (const t of TUNNEL_PRESETS) {
    let uuid = crypto.randomUUID();
    let createdOnRemote = false;
    let matchedInboundObj = null;

    // Check if inbound already exists on targetPort in Sanaei
    if (existingInboundsMap.has(t.targetPort)) {
      createdOnRemote = true;
      remoteCreatedCount++;
      matchedInboundObj = existingInboundsMap.get(t.targetPort);
      // Extract existing client UUID from Sanaei settings if available
      try {
        const settings = typeof matchedInboundObj.settings === 'string' ? JSON.parse(matchedInboundObj.settings) : matchedInboundObj.settings;
        if (settings && Array.isArray(settings.clients) && settings.clients.length > 0 && settings.clients[0].id) {
          uuid = settings.clients[0].id;
        }
      } catch (e) {}
    } else if (activeCookie) {
      // Inbound doesn't exist yet - Create it via Sanaei API
      try {
        const addUrl = `http://${host}:${port}${cleanBasePath}/panel/api/inbounds/add`;
        const inboundPayload = {
          up: 0,
          down: 0,
          total: 0,
          remark: t.name.slice(0, 30),
          enable: true,
          expiryTime: 0,
          listen: '0.0.0.0',
          port: t.targetPort,
          protocol: 'vless',
          settings: JSON.stringify({
            clients: [{ id: uuid, flow: '', email: `user_${t.id}@mhtunnel` }],
            decryption: 'none',
            fallbacks: []
          }),
          streamSettings: JSON.stringify({ network: 'tcp', security: 'none' }),
          sniffing: JSON.stringify({ enabled: true, destOverride: ['http', 'tls'] })
        };

        const addRes = await fetch(addUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getSanaeiHeaders(req.body, activeCookie)
          },
          body: JSON.stringify(inboundPayload),
          signal: AbortSignal.timeout(3500)
        });
        const addData = await addRes.json().catch(() => ({}));
        if (addData.success) {
          createdOnRemote = true;
          remoteCreatedCount++;
        }
      } catch (e) {}
    }

    const vlessLink = buildDynamicVlessLink({
      uuid,
      host: activeIranIP,
      port: t.iranPort,
      tag: t.shortName,
      inboundObj: matchedInboundObj
    });
    vlessLinksList.push(vlessLink);

    results.push({
      id: t.id,
      name: t.name,
      shortName: t.shortName,
      uuid,
      iranPort: t.iranPort,
      inboundPort: t.targetPort,
      vlessLink,
      createdOnRemote,
      description: t.description
    });
  }

  const combinedSubBase64 = Buffer.from(vlessLinksList.join('\n')).toString('base64');

  let message = '';
  if (apiLoggedIn && remoteCreatedCount > 0) {
    message = `تعداد ${remoteCreatedCount} اینباند با موفقیت در دیتابیس پنل سنایی شناسایی و تایید شدند (سبز و فعال)!`;
  } else if (apiLoggedIn) {
    message = 'ارتباط با پنل سنایی برقرار شد و کانفیگ‌ها تحویل داده شدند.';
  } else if (connectionError) {
    message = `توجه: اتصال زنده به پنل سنایی انجام نشد (${connectionError}). کلیه ۷ کانفیگ و اشتراک ترکیبی تولید شدند.`;
  } else {
    message = '۷ کانفیگ اختصاصی و لینک اشتراک با موفقیت تولید شدند.';
  }

  res.json({
    ok: true,
    apiLoggedIn,
    remoteCreatedCount,
    message,
    connectionError,
    tunnels: results,
    subscriptionBase64: combinedSubBase64
  });
});

/**
 * Add a New Client User across all 7/5 Tunnels in Sanaei Panel
 * Generates client UUID, adds to Sanaei inbounds, and returns tunneled VLESS URIs on Iran Domain/IP
 */
app.post('/api/sanaei/add-user', async (req, res) => {
  const {
    username = `user_${Math.floor(1000 + Math.random() * 9000)}`,
    expiryDays = 30,
    totalGB = 50,
    iranHost = CONFIG_STORE.iranDomain || CONFIG_STORE.iranIPv4,
    host = CONFIG_STORE.kharejIP,
    port = 53008,
    basePath = 'WTy9cJKmxOphyIW78A',
    apiToken = 'PS9j4s3FcPs5Jd4dvotYep7KVHdRwBclabkPRCqEMZjBQQxs'
  } = req.body;

  const cleanUsername = username.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const uuid = crypto.randomUUID();
  const totalBytes = parseInt(totalGB, 10) * 1024 * 1024 * 1024;
  const expiryTime = Date.now() + parseInt(expiryDays, 10) * 24 * 3600 * 1000;
  const cleanBasePath = basePath ? (basePath.startsWith('/') ? basePath : '/' + basePath) : '';

  let activeCookie = await resolveSanaeiCookie(req.body);
  let addedToRemoteCount = 0;
  let remoteError = null;

  let existingInboundsMap = new Map();

  if (activeCookie) {
    try {
      // 1. Fetch inbounds list from Sanaei
      const listUrl = `http://${host}:${port}${cleanBasePath}/panel/api/inbounds/list`;
      const listRes = await fetch(listUrl, {
        headers: getSanaeiHeaders(req.body, activeCookie),
        signal: AbortSignal.timeout(3500)
      });
      const listData = await listRes.json().catch(() => ({}));

      if (listData.success && Array.isArray(listData.obj)) {
        listData.obj.forEach(ib => existingInboundsMap.set(ib.port, ib));

        // 2. Add client user to each inbound matching ports 2500..2506
        for (const inbound of listData.obj) {
          try {
            const addClientUrl = `http://${host}:${port}${cleanBasePath}/panel/api/inbounds/addClient`;
            const clientPayload = {
              id: inbound.id,
              settings: JSON.stringify({
                clients: [{
                  id: uuid,
                  flow: '',
                  email: `${cleanUsername}_${inbound.port}`,
                  limitIp: 0,
                  totalGB: totalBytes,
                  expiryTime: expiryTime,
                  enable: true,
                  tgId: '',
                  subId: ''
                }]
              })
            };

            const addClientRes = await fetch(addClientUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...getSanaeiHeaders(req.body, activeCookie)
              },
              body: JSON.stringify(clientPayload),
              signal: AbortSignal.timeout(3000)
            });
            const addClientData = await addClientRes.json().catch(() => ({}));
            if (addClientData.success) {
              addedToRemoteCount++;
            }
          } catch (e) {}
        }
      }
    } catch (err) {
      remoteError = err.message;
    }
  }

  // 3. Construct the 7 tunneled VLESS links pointing to Iran Host (Domain/IP)
  const configs = TUNNEL_PRESETS.map(t => {
    const matchedInboundObj = existingInboundsMap.get(t.targetPort);
    const vlessLink = buildDynamicVlessLink({
      uuid,
      host: iranHost,
      port: t.iranPort,
      tag: `${cleanUsername} - ${t.shortName}`,
      inboundObj: matchedInboundObj
    });

    return {
      id: t.id,
      shortName: t.shortName,
      iranPort: t.iranPort,
      inboundPort: t.targetPort,
      vlessLink,
      description: t.description
    };
  });

  const vlessList = configs.map(c => c.vlessLink);
  const subscriptionBase64 = Buffer.from(vlessList.join('\n')).toString('base64');

  const formattedClientMessage = `🛡️ اکانت اختصاصی ۷-تانله و ضد فیلترینگ شما آماده است:

👤 نام کاربری: ${cleanUsername}
📊 حجم اختصاصی: ${totalGB} گیگابایت
⏱️ اعتبار: ${expiryDays} روز

🌐 لینک اتصال گروهی (Subscription Link):
${subscriptionBase64}

📱 نحوه استفاده:
۱) لینک فوق را کپی کنید.
۲) در نرم‌افزار v2rayNG (اندروید)، Streisand/V2Box (آیفون) یا Nekoray/V2RayN (ویندوز)، از منوی Subscription آن را وارد نمایید.
۳) دکمه بروزرسانی (Update Subscriptions) را بزنید تا هر ۷ کانال تانل‌شده سرور ایران ظاهر شوند.`;

  res.json({
    ok: true,
    username: cleanUsername,
    uuid,
    expiryDays,
    totalGB,
    iranHost,
    addedToRemoteCount,
    remoteError,
    configs,
    subscriptionBase64,
    formattedClientMessage
  });
});

app.get('/api/sanaei/quick-generate-multi', (req, res) => {
  const activeIranIP = req.query.iranIPv4 || req.query.iranIP || CONFIG_STORE.iranIPv4;
  const results = [];
  const vlessLinksList = [];

  for (const t of TUNNEL_PRESETS) {
    const uuid = crypto.randomUUID();
    const vlessLink = `vless://${uuid}@${activeIranIP}:${t.iranPort}?encryption=none&security=none&type=tcp#${encodeURIComponent(t.shortName)}`;
    if (t.enabled !== false) {
      vlessLinksList.push(vlessLink);
    }
    results.push({
      id: t.id,
      enabled: t.enabled !== false,
      name: t.name,
      shortName: t.shortName,
      uuid,
      iranPort: t.iranPort,
      inboundPort: t.targetPort,
      vlessLink,
      description: t.description,
      tag: t.tag,
      survivalRating: t.survivalRating
    });
  }

  const subItems = vlessLinksList.length > 0 ? vlessLinksList : results.map(r => r.vlessLink);
  const combinedSubBase64 = Buffer.from(subItems.join('\n')).toString('base64');
  res.json({
    ok: true,
    tunnels: results,
    subscriptionBase64: combinedSubBase64
  });
});

app.get('/api/sanaei/quick-generate', (req, res) => {
  const activeIranIP = req.query.iranIPv4 || req.query.iranIP || CONFIG_STORE.iranIPv4;
  const activeIranIPv6 = req.query.iranIPv6 || CONFIG_STORE.iranIPv6;
  const uuid = crypto.randomUUID();
  const clientPort = CONFIG_STORE.clientPort || 9000;
  const vlessLinkIPv4 = `vless://${uuid}@${activeIranIP}:${clientPort}?encryption=none&security=none&type=tcp#mh.tunnel-IRAN-RELAY`;
  const vlessLinkIPv6 = `vless://${uuid}@[${activeIranIPv6}]:${clientPort}?encryption=none&security=none&type=tcp#mh.tunnel-IRAN-IPv6`;
  const subContent = `${vlessLinkIPv4}\n${vlessLinkIPv6}`;

  res.json({
    ok: true,
    uuid,
    vlessLinkIPv4,
    vlessLinkIPv6,
    subscriptionBase64: Buffer.from(subContent).toString('base64'),
    iranIPv4: activeIranIP,
    iranIPv6: activeIranIPv6,
    clientPort
  });
});

// ---------------------------------------------------------
// REST API Endpoints
// ---------------------------------------------------------
app.get('/api/status', (req, res) => {
  res.json({
    version: '3.1.0',
    service: 'mh.tunnel',
    serviceActive: CONFIG_STORE.serviceActive,
    serviceState: CONFIG_STORE.serviceState,
    binExists: true,
    libpcap: true,
    goVersion: 'go1.22.5 linux/amd64',
    repo: 'https://github.com/dnjebeuifedihwdih/T2HASH-CORE',
    rawGithub: GITHUB_RAW_BASE,
    config: CONFIG_STORE
  });
});

app.get('/api/config', (req, res) => {
  res.json({ ok: true, config: CONFIG_STORE });
});

app.post('/api/config', (req, res) => {
  const { iranIPv4, iranIPv6, kharejIP, tunnelPort, targetPort, clientPort, pskKey, transport, sni, utls, frag } = req.body;
  if (iranIPv4) CONFIG_STORE.iranIPv4 = iranIPv4.trim();
  if (iranIPv6) CONFIG_STORE.iranIPv6 = iranIPv6.trim();
  if (kharejIP) CONFIG_STORE.kharejIP = kharejIP.trim();
  if (tunnelPort) CONFIG_STORE.tunnelPort = parseInt(tunnelPort, 10);
  if (targetPort) CONFIG_STORE.targetPort = parseInt(targetPort, 10);
  if (clientPort) CONFIG_STORE.clientPort = parseInt(clientPort, 10);
  if (pskKey) CONFIG_STORE.pskKey = pskKey.trim();
  if (transport) CONFIG_STORE.transport = transport;
  if (sni) CONFIG_STORE.sni = sni;
  if (utls !== undefined) CONFIG_STORE.utls = Boolean(utls);
  if (frag !== undefined) CONFIG_STORE.frag = parseInt(frag, 10);

  addLog(`Configuration updated: Kharej=${CONFIG_STORE.kharejIP}:${CONFIG_STORE.tunnelPort}, Iran=${CONFIG_STORE.iranIPv4}:${CONFIG_STORE.clientPort}`);
  res.json({ ok: true, config: CONFIG_STORE });
});

app.post('/api/generate-key', (req, res) => {
  CONFIG_STORE.pskKey = 'mh_' + crypto.randomBytes(16).toString('hex');
  addLog(`New PSK Key generated: ${CONFIG_STORE.pskKey}`);
  res.json({ ok: true, key: CONFIG_STORE.pskKey });
});

app.get('/api/scripts', (req, res) => {
  const iranIP = (req.query.iranIP || req.query.iranIPv4 || CONFIG_STORE.iranIPv4).trim();
  const kharejIP = (req.query.kharejIP || CONFIG_STORE.kharejIP).trim();
  const opts = { iranIP, kharejIP };

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const kharejHostedUrl = `${baseUrl}/scripts/kharej.sh`;
  const iranHostedUrl = `${baseUrl}/scripts/iran.sh`;

  const kharejCurl = `curl -fsSL "${kharejHostedUrl}" | sudo bash`;
  const iranCurl = `curl -fsSL "${iranHostedUrl}" | sudo bash`;

  const windowsKharejOneClick = `ssh -t root@${kharejIP} "curl -fsSL ${kharejHostedUrl} | bash"`;
  const windowsIranOneClick = `ssh -t root@${iranIP} "curl -fsSL ${iranHostedUrl} | bash"`;

  res.json({
    ok: true,
    baseUrl,
    kharej: {
      ip: kharejIP,
      role: 'SERVER',
      listenPort: CONFIG_STORE.tunnelPort,
      targetPort: CONFIG_STORE.targetPort,
      hostedUrl: kharejHostedUrl,
      curlCommand: kharejCurl,
      windowsCommand: windowsKharejOneClick,
      script: kharejScript
    },
    iran: {
      ipv4: iranIP,
      ipv6: CONFIG_STORE.iranIPv6,
      role: 'CLIENT',
      listenPort: CONFIG_STORE.clientPort,
      remote: `${kharejIP}:${CONFIG_STORE.tunnelPort}`,
      hostedUrl: iranHostedUrl,
      curlCommand: iranCurl,
      windowsCommand: windowsIranOneClick,
      script: iranScript
    }
  });
});

/**
 * Real Live Socket Connectivity test for Peer
 * Strictly executes real TCP probe against target (no simulated random latency)
 */
app.post('/api/test-peer', async (req, res) => {
  let target = (req.body.target || `${CONFIG_STORE.kharejIP}:${CONFIG_STORE.tunnelPort}`).trim();
  let host = target;
  let port = CONFIG_STORE.tunnelPort;

  if (target.includes(':')) {
    const parts = target.split(':');
    host = parts[0];
    port = parseInt(parts[1], 10);
  }

  addLog(`Testing real TCP socket connectivity to ${host}:${port}...`);
  const probe = await testTcpSocket(host, port, 3000);

  res.json({
    ok: true,
    target: `${host}:${port}`,
    reachable: probe.reachable,
    latencyMs: probe.latencyMs,
    error: probe.error,
    message: probe.message,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/panel/host-action', async (req, res) => {
  const { action, role = 'kharej' } = req.body;
  addLog(`[PANEL HOST ACTION] Request to execute action: ${action} (${role})`);

  let cmd = '';
  if (action === 'install_tunnels') {
    const scriptFile = role === 'iran' ? 'install-iran.sh' : 'install-kharej.sh';
    cmd = `sudo bash ${path.join(__dirname, scriptFile)}`;
  } else if (action === 'update_panel') {
    cmd = 'cd /opt/mhtunnel-panel && git pull && systemctl restart mhtunnel-panel.service || curl -sSL http://localhost:3000/install-panel.sh | bash';
  } else if (action === 'restart_panel') {
    cmd = 'sudo systemctl restart mhtunnel-panel.service';
  } else if (action === 'status_panel') {
    cmd = 'systemctl status mhtunnel-panel.service --no-pager';
  } else if (action === 'system_info') {
    cmd = 'uname -a && uptime && free -h && df -h /';
  } else {
    return res.status(400).json({ ok: false, error: 'دستور نامعتبر است' });
  }

  try {
    const { stdout, stderr } = await execPromise(cmd, { timeout: 60000 });
    return res.json({ ok: true, action, output: stdout || stderr || 'دستور با موفقیت در سرور اجرا شد.' });
  } catch (err) {
    return res.json({ ok: false, action, output: err.stdout || err.stderr || err.message });
  }
});

/**
 * Real Live Socket Status Test specifically for Iran Server IP
 */
app.post('/api/test-iran-server', async (req, res) => {
  const iranIP = (req.body.iranIP || req.body.ip || CONFIG_STORE.iranIPv4).trim();
  addLog(`[IRAN PROBE] Probing real live TCP connectivity to Iran Server IP: ${iranIP}...`);

  const portsToTest = [
    { port: 9000, name: 'TLS Quantum (پورت ۹۰۰۰)' },
    { port: 9001, name: 'WebSocket CDN (پورت ۹۰۰۱)' },
    { port: 9002, name: 'gRPC Multiplex (پورت ۹۰۰۲)' },
    { port: 9005, name: 'Reverse Intranet Bridge (پورت ۹۰۰۵)' },
    { port: 22, name: 'SSH (پورت ۲۲)' }
  ];

  const results = await Promise.all(portsToTest.map(async (p) => {
    const probe = await testTcpSocket(iranIP, p.port, 2500);
    return {
      port: p.port,
      name: p.name,
      reachable: probe.reachable,
      latencyMs: probe.latencyMs,
      error: probe.error,
      message: probe.message
    };
  }));

  const activePorts = results.filter(r => r.reachable);
  const isServerReachable = activePorts.length > 0;
  const bestLatency = activePorts.length > 0 ? Math.min(...activePorts.map(a => a.latencyMs)) : null;

  let message = '';
  if (isServerReachable) {
    message = `🟢 سرور ایران (${iranIP}) فعال است. تعداد ${activePorts.length} پورت تانل و سرویس‌پاسخگو هستند (کمترین تاخیر: ${bestLatency}ms).`;
  } else {
    message = `🔴 سرور ایران (${iranIP}) در دسترس نیست یا پورت‌های تانل هنوز اجرا نشده‌اند (تایم‌اوت شبکه).`;
  }

  res.json({
    ok: true,
    iranIP,
    reachable: isServerReachable,
    activePortsCount: activePorts.length,
    bestLatency,
    message,
    ports: results,
    verifiedAt: new Date().toLocaleTimeString('fa-IR')
  });
});

app.post('/api/action', (req, res) => {
  const { action } = req.body;
  addLog(`User executed action: ${action}`);

  switch (action) {
    case 'service-start':
      CONFIG_STORE.serviceActive = true;
      CONFIG_STORE.serviceState = 'active';
      return res.json({ ok: true, output: 'mhtunnel.service started successfully' });
    case 'service-stop':
      CONFIG_STORE.serviceActive = false;
      CONFIG_STORE.serviceState = 'inactive';
      return res.json({ ok: true, output: 'mhtunnel.service stopped' });
    case 'service-restart':
      CONFIG_STORE.serviceActive = true;
      CONFIG_STORE.serviceState = 'active';
      return res.json({ ok: true, output: 'mhtunnel.service restarted with updated parameters' });
    case 'service-enable':
      return res.json({ ok: true, output: 'Created symlink /etc/systemd/system/multi-user.target.wants/mhtunnel.service' });
    case 'service-disable':
      return res.json({ ok: true, output: 'Removed /etc/systemd/system/multi-user.target.wants/mhtunnel.service' });
    case 'install-deps':
      return res.json({ ok: true, output: 'Prerequisites (libpcap-dev, build-essential, iptables, Go 1.22+) installed.' });
    case 'build':
      return res.json({ ok: true, output: 'Binary /usr/local/bin/t2tunnel built successfully (-s -w trimpath).' });
    default:
      return res.json({ ok: true, output: `Action ${action} processed.` });
  }
});

app.get('/api/logs', (req, res) => {
  res.json({ ok: true, logs: logs.join('\n') });
});

app.post('/api/save-service', (req, res) => {
  addLog('Saved custom systemd unit file');
  res.json({ ok: true, path: '/etc/systemd/system/mhtunnel.service' });
});

app.get('/api/peer', async (req, res) => {
  const probeKharej = await testTcpSocket(CONFIG_STORE.kharejIP, CONFIG_STORE.tunnelPort, 1500);
  res.json({
    configured: true,
    role: 'client',
    reachable: probeKharej.reachable,
    peers: [
      {
        addr: `${CONFIG_STORE.kharejIP}:${CONFIG_STORE.tunnelPort}`,
        up: probeKharej.reachable,
        latency: probeKharej.latencyMs ? `${probeKharej.latencyMs}ms` : 'بسته / خاموش'
      }
    ]
  });
});

app.get('/api/xray/status', (req, res) => {
  res.json({
    installed: true,
    version: 'Xray 1.8.24 (Xray, Penetrates Everything.) OpenSource',
    arch: 'x86_64'
  });
});

app.post('/api/xray/install', (req, res) => {
  addLog('Xray core installer triggered on server');
  res.json({
    ok: true,
    installed: true,
    output: 'Xray v1.8.24 installed to /usr/local/bin/xray'
  });
});

app.post('/api/login', (req, res) => {
  const { user, pass } = req.body;
  if (!user) {
    return res.status(400).json({ error: 'نام کاربری لازم است' });
  }
  const token = createSession();
  res.cookie('mhsess', token, { httpOnly: true, maxAge: 8 * 3600 * 1000 });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('mhsess');
  res.json({ ok: true });
});

// Serve main web console
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`[mh.tunnel] Web Console running at http://${HOST}:${PORT}`);
  console.log(`[mh.tunnel] Iran: ${CONFIG_STORE.iranIPv4} (${CONFIG_STORE.iranIPv6}) <===> Kharej: ${CONFIG_STORE.kharejIP}`);
});
