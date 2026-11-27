import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SCRIPT = path.resolve(process.cwd(), "scripts", "check-loading-states.mjs");
const tempDirs: string[] = [];

function makeTempWorkspace(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-loading-check-"));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  return dir;
}

function runCheck(dir: string) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, "--target", dir], {
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: stdout };
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string };
    return { ok: false, output: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()!;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("check-loading-states enforcement", () => {
  it("fails on forbidden loading text literals in JSX", () => {
    const dir = makeTempWorkspace({
      "src/components/Bad.tsx": `export function Bad() { return <div>Loading data...</div>; }\n`,
    });
    const res = runCheck(dir);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("[loading-text]");
  });

  it("fails on spinner / animate-spin outside allowlist", () => {
    const dir = makeTempWorkspace({
      "src/components/Spin.tsx": `export function Spin() { return <div className="animate-spin" />; }\n`,
    });
    const res = runCheck(dir);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("[spinner]");
  });

  it("fails on Suspense fallback={null}", () => {
    const dir = makeTempWorkspace({
      "src/components/Susp.tsx": `export function Susp() { return <Suspense fallback={null}><div /></Suspense>; }\n`,
    });
    const res = runCheck(dir);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("[fallback-null]");
  });

  it("fails on if (isLoading) return null", () => {
    const dir = makeTempWorkspace({
      "src/components/RetNull.tsx": `export function RetNull({ isLoading }: { isLoading: boolean }) { if (isLoading) return null; return <div />; }\n`,
    });
    const res = runCheck(dir);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("[null-loading-return]");
  });

  it("fails on hardcoded colors inside skeleton components", () => {
    const dir = makeTempWorkspace({
      "src/components/skeletons/BadSkeleton.tsx": `export function BadSkeleton() { return <div className="bg-gray-200" />; }\n`,
    });
    const res = runCheck(dir);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("[hardcoded-skeleton-color]");
  });

  it("fails on page.tsx without sibling loading.tsx", () => {
    const dir = makeTempWorkspace({
      "src/app/reports/page.tsx": `export default function ReportsPage() { return <main />; }\n`,
    });
    const res = runCheck(dir);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("[missing-loading-route]");
  });

  it("passes when entries are properly allowlisted", () => {
    const dir = makeTempWorkspace({
      "src/components/AllowedSpin.tsx": `export function AllowedSpin() { return <button><span className="animate-spin" /></button>; }\n`,
      "loading-allowlist.yaml": `entries:\n  - file: src/components/AllowedSpin.tsx\n    rule: spinner\n    justification: In-button action spinner\n`,
    });
    const res = runCheck(dir);
    expect(res.ok).toBe(true);
  });

  it("verifies CSS surface-derived skeleton tokens and accessibility media queries exist", () => {
    const appCss = fs.readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");

    expect(appCss).toContain("--sk-surface:");
    expect(appCss).toContain("--sk-base: color-mix(in oklab");
    expect(appCss).toContain("--sk-shine: color-mix(in oklab");
    expect(appCss).toContain("forced-colors: active");
    expect(appCss).toContain("prefers-contrast: more");
    expect(appCss).toContain("prefers-reduced-motion: reduce");
  });
});
