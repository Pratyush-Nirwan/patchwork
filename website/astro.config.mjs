import fs from "node:fs";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import sitemap from "@astrojs/sitemap";
import starlightLinksValidator from "starlight-links-validator";

const meta = JSON.parse(
  fs.readFileSync(new URL("./src/data/generated/app-meta.json", import.meta.url), "utf8")
);

const buildTarget = process.env.BUILD_TARGET === "embedded" ? "embedded" : "website";
const isEmbedded = buildTarget === "embedded";
const rawBase = isEmbedded ? "/" : process.env.SITE_BASE || "/";
const siteBase =
  rawBase === "" || rawBase === "/" ? "/" : `/${rawBase.replace(/^\/+|\/+$/g, "")}`;
const basePrefix = siteBase === "/" ? "" : siteBase;
const defaultSiteOrigin = new URL(meta.docsSiteUrl || "https://getpatchwork.in/").origin;
const rawSiteUrl =
  !isEmbedded
    ? process.env.SITE_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : defaultSiteOrigin)
    : "";
const siteUrl = rawSiteUrl ? rawSiteUrl.replace(/\/+$/, "") : undefined;
const repoUrl = process.env.REPO_URL || meta.repositoryUrl;

function prefixHref(href) {
  if (!basePrefix || typeof href !== "string") return href;
  if (
    href.startsWith("/") &&
    !href.startsWith("//") &&
    href !== basePrefix &&
    !href.startsWith(`${basePrefix}/`)
  ) {
    return `${basePrefix}${href}`;
  }
  return href;
}

function remarkPrefixBase() {
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "link" && typeof node.url === "string") {
      node.url = prefixHref(node.url);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }
  return (tree) => walk(tree);
}

function rehypePrefixBase() {
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "element" && node.tagName === "a" && node.properties?.href) {
      node.properties.href = prefixHref(node.properties.href);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }
  return (tree) => walk(tree);
}

const headTags = [
  {
    tag: "meta",
    attrs: { name: "patchwork:version", content: meta.version },
  },
];

if (isEmbedded) {
  headTags.push({
    tag: "meta",
    attrs: { name: "robots", content: "noindex" },
  });
}

export default defineConfig({
  ...(siteUrl ? { site: siteUrl } : {}),
  base: siteBase,
  build: {
    assets: isEmbedded ? "documentation/_astro" : "_astro",
  },
  markdown: {
    remarkPlugins: basePrefix ? [remarkPrefixBase] : [],
    rehypePlugins: basePrefix ? [rehypePrefixBase] : [],
  },
  integrations: [
    starlight({
      title: "Patchwork",
      disable404Route: true,
      routeMiddleware: "./src/routeData.ts",
      description:
        "Official documentation for Patchwork, a self-hosted engineering ticketing platform.",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: false,
      },
      favicon: isEmbedded ? "/documentation/favicon.svg" : `${basePrefix}/favicon.svg`,
      editLink: {
        baseUrl: `${repoUrl}/edit/main/website/`,
      },
      lastUpdated: true,
      customCss: ["./src/styles/tokens.css", "./src/styles/custom.css"],
      components: {
        Footer: "./src/components/Footer.astro",
        Header: "./src/components/Header.astro",
        Head: "./src/components/Head.astro",
      },
      head: headTags,
      plugins: [starlightLinksValidator()],
      sidebar: [
        {
          label: "Introduction",
          items: [{ label: "Overview & Concepts", slug: "documentation/introduction/overview" }],
        },
        {
          label: "Getting Started",
          items: [
            { label: "Quick Start", slug: "documentation/getting-started/quick-start" },
            { label: "Installation", slug: "documentation/getting-started/installation" },
            { label: "Advanced Installation", slug: "documentation/getting-started/advanced-installation" },
            { label: "Setup Wizard", slug: "documentation/getting-started/setup-wizard" },
            { label: "Domain & HTTPS", slug: "documentation/getting-started/domain-and-https" },
          ],
        },
        {
          label: "User Guide",
          items: [
            { label: "Workspace & Boards", slug: "documentation/user-guide/workspace-and-boards" },
            { label: "Tickets & Collaboration", slug: "documentation/user-guide/tickets-and-collaboration" },
            { label: "Attachments & Links", slug: "documentation/user-guide/attachments-and-links" },
            { label: "Search & Filters", slug: "documentation/user-guide/search-and-filters" },
            { label: "Command Palette & Slash Commands", slug: "documentation/user-guide/command-palette" },
            { label: "Shortcuts & Themes", slug: "documentation/user-guide/shortcuts-and-themes" },
          ],
        },
        {
          label: "Admin Guide",
          items: [
            { label: "System Configuration", slug: "documentation/admin-guide/system-configuration" },
            { label: "User Management", slug: "documentation/admin-guide/user-management" },
            { label: "Sessions & Security Policy", slug: "documentation/admin-guide/sessions-and-security-policy" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Command Palette & Shortcuts", slug: "documentation/reference/command-palette" },
            { label: "Roles & Permissions", slug: "documentation/reference/roles-and-permissions" },
            { label: "Configuration & Settings", slug: "documentation/reference/configuration" },
            { label: "Database Schema", slug: "documentation/reference/database-schema" },
            { label: "Installer CLI", slug: "documentation/reference/installer-cli" },
          ],
        },
        {
          label: "Operations",
          items: [
            { label: "Monitoring & Maintenance", slug: "documentation/operations/monitoring-and-maintenance" },
            { label: "Backups & Upgrades", slug: "documentation/operations/backups-and-upgrades" },
            { label: "Security", slug: "documentation/operations/security" },
            { label: "Troubleshooting & FAQ", slug: "documentation/operations/troubleshooting" },
          ],
        },
        {
          label: "Development",
          items: [
            { label: "Local Setup", slug: "documentation/development/local-setup" },
            { label: "Database Seeding", slug: "documentation/development/seeding" },
            { label: "Cross-Platform Rules", slug: "documentation/development/cross-platform" },
            { label: "Contributing & Extending", slug: "documentation/development/contributing-and-extending" },
            { label: "Writing Changelog Entries", slug: "documentation/development/writing-changelog-entries" },
            { label: "UI Motion & Loading States", slug: "documentation/development/ui-motion-and-loading" },
            { label: "Architecture", slug: "documentation/development/architecture" },
          ],
        },
        {
          label: "Changelog",
          autogenerate: { directory: "documentation/changelog" },
        },
        {
          label: "Project",
          items: [
            { label: "Roadmap & Known Limitations", slug: "documentation/project/roadmap" },
            { label: "License & Contributing", slug: "documentation/project/license-and-contributing" },
          ],
        },
      ],
    }),
    ...(siteUrl ? [sitemap()] : []),
  ],
});
