"use client";

import { useCallback, useSyncExternalStore } from "react";
import { shortSupplierId } from "@/lib/pseudonym";

/**
 * Supplier nicknames live only in this browser (localStorage), keyed by the pseudonymous supplier ID
 * the server returned. The server only ever receives an HMAC token of the nickname.
 * Demo nicknames are merged in for the seeded, illustrative suppliers.
 */
const KEY = "landed:nicknames";
const listeners = new Set<() => void>();
let cache: Record<string, string> | null = null;

function read(): Record<string, string> {
  if (cache) return cache;
  if (typeof window === "undefined") return {};
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    cache = {};
  }
  return cache!;
}

function write(next: Record<string, string>) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: keep in memory */
  }
  listeners.forEach((l) => l());
}

export function mergeDemoNicknames(demo: Record<string, string>) {
  const cur = read();
  const missing = Object.entries(demo).filter(([h]) => !cur[h]);
  if (missing.length) write({ ...cur, ...Object.fromEntries(missing) });
}

export function rememberNickname(supplierId: string, nickname: string): void {
  write({ ...read(), [supplierId]: nickname.trim() });
}

export function clearNicknames() {
  write({});
}

const EMPTY = {};
export function useNicknames() {
  const map = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => EMPTY as Record<string, string>,
  );
  const nameFor = useCallback((hash: string) => map[hash] ?? `Supplier #${shortSupplierId(hash)}`, [map]);
  const hasName = useCallback((hash: string) => !!map[hash], [map]);
  return { map, nameFor, hasName };
}
