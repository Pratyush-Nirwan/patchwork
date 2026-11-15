const rawVersion = (
  process.env.NEXT_PUBLIC_APP_VERSION ||
  process.env.npm_package_version ||
  "0.0.0-unknown"
).trim();

const normalized = rawVersion.startsWith("v") ? rawVersion.slice(1) : rawVersion;

export const version = normalized;
export const displayVersion = `v${normalized}`;
export const tag = `v${normalized}`;

const dashIdx = normalized.indexOf("-");
export const channel =
  dashIdx === -1
    ? "stable"
    : normalized.slice(dashIdx + 1).split(".")[0].toLowerCase();

export const buildDate = (
  process.env.NEXT_PUBLIC_APP_BUILD_DATE ||
  new Date().toISOString().slice(0, 10)
).trim();
