import fs from "fs";
import path from "path";
import { getSystemInfo } from "../lib/platform.mjs";

export async function detectPublicIp() {
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ip) return String(data.ip);
    }
  } catch {
    // Offline or blocked in sandbox
  }
  return "<YOUR_SERVER_PUBLIC_IP>";
}

export function generateCaddyfileContent({
  domain = "tickets.example.com",
  appPort = 3000,
  minioPort = 9000,
}) {
  return `${domain} {
  encode zstd gzip

  # Real-time Server-Sent Events (SSE) - disable proxy buffering
  @sse {
    path /api/events*
  }
  handle @sse {
    reverse_proxy 127.0.0.1:${appPort} {
      flush_interval -1
      transport http {
        read_timeout 24h
      }
    }
  }

  handle {
    reverse_proxy 127.0.0.1:${appPort}
  }
}

files.${domain} {
  # Dedicated host for MinIO S3 API (no path rewriting so presigned URLs validate)
  reverse_proxy 127.0.0.1:${minioPort} {
    flush_interval -1
  }
}
`;
}

export function generateNginxConfContent({
  domain = "tickets.example.com",
  appPort = 3000,
  minioPort = 9000,
}) {
  return `server {
    listen 80;
    server_name ${domain};

    client_max_body_size 20M;

    # Real-time Server-Sent Events (SSE) - disable buffering & extend timeout
    location /api/events {
        proxy_pass http://127.0.0.1:${appPort};
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 86400s;
    }

    location / {
        proxy_pass http://127.0.0.1:${appPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name files.${domain};

    # Match Patchwork attachment upload limit
    client_max_body_size 20M;

    # Dedicated host for MinIO API without path rewriting so S3 v4 presigned URLs validate
    location / {
        proxy_pass http://127.0.0.1:${minioPort};
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_connect_timeout 300s;
        proxy_send_timeout 86400s;
        proxy_read_timeout 86400s;
    }
}
`;
}

export function buildDomainSetupGuide({
  domain = "tickets.example.com",
  publicUrl = `https://${domain}`,
  publicIp = "<YOUR_SERVER_PUBLIC_IP>",
  appPort = 3000,
  minioPort = 9000,
  proxyType = "caddy",
}) {
  const sys = getSystemInfo();
  const ufwNote = sys.isLinux
    ? sys.hasUfw
      ? "Linux detected with `ufw`: confirm before running the `ufw` commands below."
      : "Linux detected (`ufw` not installed): open ports 80/tcp and 443/tcp in your firewall."
    : `Detected ${sys.platform}: ufw is Linux-only. On Windows/macOS, configure reverse proxy and firewall rules on your production host.`;

  return `# Patchwork Domain & HTTPS Setup Guide

## 1. Create DNS Records
Point both your app domain \`${domain}\` and your dedicated MinIO file host \`files.${domain}\` to your server's public IP (\`${publicIp}\`):
- **A Record**: \`${domain}\` -> \`${publicIp}\` (TTL 300)
- **A Record**: \`files.${domain}\` -> \`${publicIp}\` (TTL 300)
- **AAAA Record** (if IPv6 enabled): \`${domain}\` and \`files.${domain}\` -> \`<YOUR_IPV6_ADDRESS>\`

## 2. Open Firewall Ports 80 and 443
${ufwNote}
\`\`\`bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
\`\`\`

## 3. Configure Reverse Proxy (${proxyType === "nginx" ? "Nginx + Certbot" : "Caddy (Automatic HTTPS)"}) -> App Port ${appPort}
SSE-safe settings (\`proxy_buffering off\` / \`flush_interval -1\` and 24h read timeout on \`/api/events\`) are included in the generated config.

### Option A: Caddy (\`deploy/Caddyfile\`)
\`\`\`bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
\`\`\`

### Option B: Nginx + Certbot (\`deploy/nginx.conf\`)
\`\`\`bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/patchwork.conf
sudo ln -sf /etc/nginx/sites-available/patchwork.conf /etc/nginx/sites-enabled/patchwork.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ${domain} -d files.${domain}
\`\`\`

## 4. Update \`.env\` and Verify with \`curl\`
Set \`APP_URL=${publicUrl}\` and \`MINIO_PUBLIC_URL=https://files.${domain}\` in \`.env\`, restart Patchwork, and test:
\`\`\`bash
sudo systemctl restart patchwork.service
curl -I ${publicUrl}/api/health
\`\`\`

## 5. Dedicated MinIO File Host (\`MINIO_PUBLIC_URL\`)
Browsers upload and download attachments directly via S3 presigned URLs, which include the \`Host\` header in their cryptographic signature. Never rewrite URL paths. Use the dedicated \`files.${domain}\` server block in \`deploy/Caddyfile\` or \`deploy/nginx.conf\` (which proxies \`/\` directly to \`127.0.0.1:${minioPort}\` while preserving \`Host\`) and set:
\`\`\`env
MINIO_PUBLIC_URL=https://files.${domain}
\`\`\`
For localhost/no-domain installs, keep \`MINIO_PUBLIC_URL=http://localhost:${minioPort}\`.
`;
}

export async function handleDomainConfiguration({
  projectDir = process.cwd(),
  choice = "no", // "yes" | "no" | "later"
  domain = "tickets.example.com",
  publicUrl,
  appPort = 3000,
  minioPort = 9000,
  proxyType = "caddy", // "caddy" | "nginx"
}) {
  const resolvedUrl =
    publicUrl ||
    (choice === "yes" ? `https://${domain}` : `http://localhost:${appPort}`);
  const publicIp = await detectPublicIp();

  if (choice === "later") {
    const docPath = path.join(projectDir, "DOMAIN_SETUP.md");
    const guide = buildDomainSetupGuide({
      domain,
      publicUrl: `https://${domain}`,
      publicIp,
      appPort,
      minioPort,
      proxyType,
    });
    fs.writeFileSync(docPath, guide, "utf8");
    return {
      choice: "later",
      appUrl: `http://localhost:${appPort}`,
      domainSetupDocPath: docPath,
      guide,
    };
  }

  if (choice === "yes") {
    const deployDir = path.join(projectDir, "deploy");
    fs.mkdirSync(deployDir, { recursive: true });
    let generatedProxyPath = "";

    if (proxyType === "nginx") {
      generatedProxyPath = path.join(deployDir, "nginx.conf");
      fs.writeFileSync(
        generatedProxyPath,
        generateNginxConfContent({ domain, appPort, minioPort }),
        "utf8"
      );
    } else {
      generatedProxyPath = path.join(deployDir, "Caddyfile");
      fs.writeFileSync(
        generatedProxyPath,
        generateCaddyfileContent({ domain, appPort, minioPort }),
        "utf8"
      );
    }

    const guide = buildDomainSetupGuide({
      domain,
      publicUrl: resolvedUrl,
      publicIp,
      appPort,
      minioPort,
      proxyType,
    });

    return {
      choice: "yes",
      domain,
      appUrl: resolvedUrl,
      minioPublicUrl: `https://files.${domain}`,
      generatedProxyPath,
      publicIp,
      guide,
    };
  }

  return {
    choice: "no",
    appUrl: `http://localhost:${appPort}`,
    minioPublicUrl: `http://localhost:${minioPort}`,
    guide: "",
  };
}

