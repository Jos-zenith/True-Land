"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Entry = { data: unknown; error: ApiError | null; loading: boolean; promise: Promise<void> | null; stamp: number };
const store = new Map<string, Entry>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Could not reach the server. Check your connection and try again.");
  }
  const json = await res.json().catch(() => null);
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }
  if (!res.ok) {
    const e = json?.error ?? {};
    const { code, message, fields, ...extra } = e;
    throw new ApiError(res.status, code ?? "HTTP", message ?? `Request failed (${res.status}).`, fields ?? {}, extra);
  }
  return json as T;
}

function load(url: string) {
  const prev = store.get(url);
  if (prev?.promise) return prev.promise;
  const entry: Entry = { data: prev?.data, error: null, loading: true, promise: null, stamp: prev?.stamp ?? 0 };
  entry.promise = request<unknown>("GET", url)
    .then((data) => {
      store.set(url, { data, error: null, loading: false, promise: null, stamp: Date.now() });
    })
    .catch((error: ApiError) => {
      store.set(url, { data: prev?.data, error, loading: false, promise: null, stamp: Date.now() });
    })
    .finally(emit);
  store.set(url, entry);
  emit();
  return entry.promise;
}

/** Refetch every cached resource (after any mutation). Keeps showing current data while refreshing. */
export function invalidateAll(): Promise<void> {
  return Promise.all([...store.keys()].map((k) => {
    const e = store.get(k);
    if (e) store.set(k, { ...e, promise: null });
    return load(k);
  })).then(() => undefined);
}

const EMPTY: Entry = { data: undefined, error: null, loading: true, promise: null, stamp: 0 };

export function useApi<T>(url: string | null) {
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => (url ? store.get(url) ?? EMPTY : EMPTY),
    () => EMPTY,
  );
  useEffect(() => {
    if (url && !store.get(url)?.stamp && !store.get(url)?.promise) void load(url);
  }, [url]);
  const reload = useCallback(() => (url ? load(url) : Promise.resolve()), [url]);
  return { data: snap.data as T | undefined, error: snap.error, loading: snap.loading && snap.data === undefined, refreshing: snap.loading, reload };
}

/** Mutations: send, then refresh everything so every view stays consistent with the server. */
export async function apiSend<T = unknown>(method: "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown): Promise<T> {
  const out = await request<T>(method, url, body);
  void invalidateAll();
  return out;
}
