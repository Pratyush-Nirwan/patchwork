import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEBSITE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const targetArg = process.argv.find((a) => a.startsWith("--target="));
const target =
  (targetArg ? targetArg.split("=")[1] : process.env.BUILD_TARGET) || "website";

if (target !== "website" && target !== "embedded") {
  console.error(`Invalid BUILD_TARGET "${target}". Expected "website" or "embedded".`);
  process.exit(1);
}

// Clean Astro cache so base / assets never leak across targets
fs.rmSync(path.join(WEBSITE_ROOT, ".astro"), { recursive: true, force: true });
fs.rmSync(path.join(WEBSITE_ROOT, "dist"), { recursive: true, force: true });

const env = {
  ...process.env,
  BUILD_TARGET: target,
  SITE_BASE: target === "embedded" ? "/" : process.env.SITE_BASE || "/",
};

const astroEntry = path.join(WEBSITE_ROOT, "node_modules", "astro", "astro.js");

execFileSync(process.execPath, [astroEntry, "check"], {
  cwd: WEBSITE_ROOT,
  env,
  stdio: "inherit",
  shell: false,
});

execFileSync(process.execPath, [astroEntry, "build"], {
  cwd: WEBSITE_ROOT,
  env,
  stdio: "inherit",
  shell: false,
});

if (target === "website") {
  // Generate _headers for Netlify / Cloudflare Pages
  const headersContent = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'

/_astro/*
  Cache-Control: public, max-age=31536000, immutable

/documentation/pagefind/*
  Cache-Control: public, max-age=86400
`;
  fs.writeFileSync(path.join(WEBSITE_ROOT, "dist/_headers"), headersContent, "utf8");
} else if (target === "embedded") {
  // Embedded docs are mounted at /documentation/ in Next.js, so point Pagefind bundlePath there.
  const astroDir = path.join(WEBSITE_ROOT, "dist/documentation/_astro");
  if (fs.existsSync(astroDir)) {
    for (const file of fs.readdirSync(astroDir)) {
      if (file.startsWith("Search.") && file.endsWith(".js")) {
        const fullPath = path.join(astroDir, file);
        const js = fs.readFileSync(fullPath, "utf8");
        const patched = js.replaceAll(
          'bundlePath:"/".replace(/\\/$/,"")+"/pagefind/"',
          'bundlePath:"/documentation/pagefind/"'
        );
        if (patched !== js) fs.writeFileSync(fullPath, patched, "utf8");
      }
    }
  }
}

console.log(`Built @patchwork/website (target=${target})`);
