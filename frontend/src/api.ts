const API_BASE = import.meta.env.PROD
  ? (import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "")
  : "";

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    API_BASE + "/api" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!r.ok) {
    const e = await r.json().catch(() => null);
    throw new Error(
      typeof e?.detail === "string"
        ? e.detail
        : `Request failed (${r.status}). Check the inputs and try again.`,
    );
  }
  return r.json();
}
