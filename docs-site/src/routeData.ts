import { defineRouteMiddleware } from "@astrojs/starlight/route-data";

export const onRequest = defineRouteMiddleware((context) => {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, "");
  if (!base) return;

  const { hero } = context.locals.starlightRoute.entry.data;
  if (!hero?.actions) return;

  for (const action of hero.actions) {
    if (
      action.link.startsWith("/") &&
      !action.link.startsWith("//") &&
      action.link !== base &&
      !action.link.startsWith(`${base}/`)
    ) {
      action.link = `${base}${action.link}`;
    }
  }
});
