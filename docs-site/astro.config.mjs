import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import sitemap from "@astrojs/sitemap";
import starlightLinksValidator from "starlight-links-validator";

import { getVersionInfo } from "../scripts/lib/version.mjs";

const { version: appVersion } = getVersionInfo(
  path.resolve(import.meta.dirname, "..")
);

const rawBase = process.env.DOCS_BASE ?? "/documentation";
const docsBase =
  rawBase === "" || rawBase === "/"
    ? "/"
    : `/${rawBase.replace(/^\/+|\/+$/g, "")}`;
const docsSiteUrl = process.env.DOCS_SITE_URL || undefined;
const isEmbedded =
  process.env.DOCS_EMBEDDED !== "false" && docsBase === "/documentation";
const basePrefix = docsBase === "/" ? "" : docsBase;

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
    attrs: {
      property: "og:image",
      content: `${basePrefix}/og-image.svg`,
    },
  },
  {
    tag: "meta",
    attrs: {
      name: "patchwork:version",
      content: appVersion,
    },
  },
];

if (isEmbedded) {
  headTags.push({
    tag: "meta",
    attrs: {
      name: "robots",
      content: "noindex",
    },
  });
}

export default defineConfig({
  ...(docsSiteUrl ? { site: docsSiteUrl } : {}),
  base: docsBase,
  markdown: {
    remarkPlugins: basePrefix ? [remarkPrefixBase] : [],
    rehypePlugins: basePrefix ? [rehypePrefixBase] : [],
  },
  integrations: [
    starlight({
      title: "Patchwork",
      routeMiddleware: "./src/routeData.ts",
      description:
        "Official documentation for Patchwork, a self-hosted engineering ticketing platform.",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: false,
      },
      favicon: "/favicon.svg",
      editLink: {
        baseUrl: "https://github.com/owner/patchwork/edit/main/docs-site/",
      },
      lastUpdated: true,
      customCss: ["./src/styles/custom.css"],
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
          items: [{ label: "Overview & Concepts", slug: "introduction/overview" }],
        },
        {
          label: "Getting Started",
          items: [
            { label: "Quick Start", slug: "getting-started/quick-start" },
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Setup Wizard", slug: "getting-started/setup-wizard" },
            { label: "Domain & HTTPS", slug: "getting-started/domain-and-https" },
          ],
        },
        {
          label: "User Guide",
          items: [
            { label: "Workspace & Boards", slug: "user-guide/workspace-and-boards" },
            { label: "Tickets & Collaboration", slug: "user-guide/tickets-and-collaboration" },
            { label: "Attachments & Links", slug: "user-guide/attachments-and-links" },
            { label: "Search & Filters", slug: "user-guide/search-and-filters" },
            { label: "Command Palette & Slash Commands", slug: "user-guide/command-palette" },
            { label: "Shortcuts & Themes", slug: "user-guide/shortcuts-and-themes" },
          ],
        },
        {
          label: "Admin Guide",
          items: [
            { label: "System Configuration", slug: "admin-guide/system-configuration" },
            { label: "User Management", slug: "admin-guide/user-management" },
            { label: "Sessions & Security Policy", slug: "admin-guide/sessions-and-security-policy" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Command Palette & Shortcuts", slug: "reference/command-palette" },
            { label: "Roles & Permissions", slug: "reference/roles-and-permissions" },
            { label: "Configuration & Settings", slug: "reference/configuration" },
            { label: "Database Schema", slug: "reference/database-schema" },
            { label: "Installer CLI", slug: "reference/installer-cli" },
          ],
        },
        {
          label: "Operations",
          items: [
            { label: "Monitoring & Maintenance", slug: "operations/monitoring-and-maintenance" },
            { label: "Backups & Upgrades", slug: "operations/backups-and-upgrades" },
            { label: "Security", slug: "operations/security" },
            { label: "Troubleshooting & FAQ", slug: "operations/troubleshooting" },
          ],
        },
        {
          label: "Development",
          items: [
            { label: "Local Setup", slug: "development/local-setup" },
            { label: "Database Seeding", slug: "development/seeding" },
            { label: "Cross-Platform Rules", slug: "development/cross-platform" },
            { label: "Contributing & Extending", slug: "development/contributing-and-extending" },
            { label: "UI Motion & Loading States", slug: "development/ui-motion-and-loading" },
            { label: "Architecture", slug: "development/architecture" },
          ],
        },
        {
          label: "Project",
          items: [
            { label: "Changelog", slug: "project/changelog" },
            { label: "Roadmap & Known Limitations", slug: "project/roadmap" },
            { label: "License & Contributing", slug: "project/license-and-contributing" },
          ],
        },
      ],
    }),
    ...(docsSiteUrl ? [sitemap()] : []),
  ],
});
