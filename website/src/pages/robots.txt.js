export const GET = () => {
  const isEmbedded = process.env.BUILD_TARGET === "embedded";
  const siteUrl = (process.env.SITE_URL || "").replace(/\/+$/, "");
  const rawBase = process.env.SITE_BASE || "/";
  const basePrefix = rawBase === "/" ? "" : `/${rawBase.replace(/^\/+|\/+$/g, "")}`;

  const body = isEmbedded
    ? "User-agent: *\nDisallow: /\n"
    : [
        "User-agent: *",
        "Allow: /",
        ...(siteUrl ? [`Sitemap: ${siteUrl}${basePrefix}/sitemap-index.xml`] : []),
        "",
      ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
