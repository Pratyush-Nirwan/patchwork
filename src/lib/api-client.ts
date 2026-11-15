export interface ApiFetchOptions {
  csrfToken?: string;
  onIdleExpired?: () => void;
}

export async function apiFetchJson(
  url: string,
  init?: RequestInit,
  options: ApiFetchOptions = {}
) {
  const headers = new Headers(init?.headers || {});
  if (options.csrfToken && init?.method && init.method !== "GET") {
    headers.set("x-csrf-token", options.csrfToken);
  }
  if (init?.body && typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (
      res.status === 401 &&
      data &&
      typeof data === "object" &&
      "code" in data &&
      data.code === "SESSION_IDLE_EXPIRED"
    ) {
      options.onIdleExpired?.();
    }
    const errorMsg =
      (data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : null) ||
      (data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : null) ||
      `Request failed (${res.status})`;
    throw new Error(errorMsg);
  }
  return data;
}
