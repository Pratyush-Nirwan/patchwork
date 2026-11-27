import appMeta from "../data/generated/app-meta.json";

export const GET = () => {
  const isEmbedded = process.env.BUILD_TARGET === "embedded";
  const defaultOrigin = new URL(appMeta.docsSiteUrl || "https://getpatchwork.in/").origin;
  const rawSiteUrl =
    process.env.SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : defaultOrigin);
  const siteUrl = rawSiteUrl.replace(/\/+$/, "");
  const rawBase = process.env.SITE_BASE || "/";
  const basePrefix = rawBase === "/" ? "" : `/${rawBase.replace(/^\/+|\/+$/g, "")}`;

  const body = isEmbedded
    ? "User-agent: *\nDisallow: /\n"
    : [
        "User-agent: *",
        "Allow: /",
        `Sitemap: ${siteUrl}${basePrefix}/sitemap-index.xml`,
        "",
      ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
