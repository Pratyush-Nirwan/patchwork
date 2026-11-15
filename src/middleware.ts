import { NextRequest, NextResponse } from "next/server";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/documentation" ||
    pathname.startsWith("/documentation/")
  ) {
    return NextResponse.next();
  }

  try {
    const statusUrl = new URL("/api/setup/status", req.url);
    const res = await fetch(statusUrl, {
      cache: "no-store",
      headers: {
        "x-patchwork-internal": "1",
      },
    });
    if (res.ok) {
      const data = (await res.json()) as { isCompleted: boolean };
      if (!data.isCompleted && !pathname.startsWith("/setup")) {
        return NextResponse.redirect(new URL("/setup", req.url));
      }
      if (data.isCompleted && pathname.startsWith("/setup")) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }
  } catch {
    // Fallback to server component check if internal fetch fails
  }

  if (pathname.startsWith("/dashboard/system")) {
    try {
      const authCheckUrl = new URL("/api/system/auth-check", req.url);
      const res = await fetch(authCheckUrl, {
        cache: "no-store",
        headers: {
          cookie: req.headers.get("cookie") || "",
          authorization: req.headers.get("authorization") || "",
          "x-org-id": req.headers.get("x-org-id") || "",
        },
      });

      if (res.status === 401) {
        const data = await res.json().catch(() => ({}));
        const target = new URL("/", req.url);
        if (data && data.code === "SESSION_IDLE_EXPIRED") {
          target.searchParams.set("reason", "idle_expired");
          target.searchParams.set("returnTo", pathname + req.nextUrl.search);
        }
        return NextResponse.redirect(target);
      }
      if (!res.ok) {
        return new NextResponse(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>403 - Forbidden</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a}main{max-width:420px;padding:24px;border:1px solid #fecaca;background:#fff;border-radius:8px;text-align:center}h1{font-size:18px;color:#dc2626;margin:0 0 8px}p{font-size:13px;color:#475569;margin:0 0 16px}a{display:inline-block;padding:8px 14px;background:#c84317;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600}</style></head><body><main><h1>403 - Forbidden</h1><p>Organization administrator privileges are required to access System Configuration.</p><a href="/">Return to Workspace</a></main></body></html>`,
          {
            status: 403,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }
        );
      }
    } catch {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|documentation(?:/.*)?$).*)"],
};

