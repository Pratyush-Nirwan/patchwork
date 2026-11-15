import path from "path";

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export function getPlatformInfo() {
  return {
    platform: process.platform,
    arch: process.arch,
    isWindows: process.platform === "win32",
    isLinux: process.platform === "linux",
    isMac: process.platform === "darwin",
  };
}

export function defaultMinioDataDir(bucket: string): string {
  const safeBucket = sanitizeFilename(bucket, "patchwork");
  return path.join(process.cwd(), ".minio-data", safeBucket);
}

/**
 * Sanitize filenames for both Windows and POSIX rules:
 * strips paths, control chars, forbidden chars (<>:"/\|?*),
 * trailing dots/spaces, Windows reserved device names (CON, NUL, COM1...),
 * and caps length to stay safely under Windows 260-char path limits.
 */
export function sanitizeFilename(rawName: string, fallback = "file"): string {
  const baseOnly =
    String(rawName || "")
      .replace(/[\r\n\0]/g, "")
      .split(/[/\\]/)
      .pop() || "";

  let cleaned = baseOnly
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();

  if (!cleaned || cleaned === "." || cleaned === "..") {
    cleaned = fallback;
  }

  const dotIdx = cleaned.lastIndexOf(".");
  let stem = dotIdx > 0 ? cleaned.slice(0, dotIdx) : cleaned;
  let ext = dotIdx > 0 ? cleaned.slice(dotIdx) : "";
  ext = ext.replace(/[. ]+$/g, "");

  if (WINDOWS_RESERVED_NAMES.has(stem.toUpperCase())) {
    stem = `_${stem}`;
  }

  const maxLen = 180;
  if (stem.length + ext.length > maxLen) {
    stem = stem.slice(0, Math.max(1, maxLen - ext.length));
  }

  return `${stem}${ext}` || fallback;
}

