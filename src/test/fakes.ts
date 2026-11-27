import fs from "node:fs";
import path from "node:path";

export const FIXTURES = path.resolve(__dirname, "../server/integrations/fixtures");
export const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

export interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

type Reply = { status?: number; body?: string; headers?: Record<string, string> } | Error;

/**
 * A fake fetch. `handler` decides the reply for each request; every call is recorded so tests can
 * assert what was sent (URL, headers, body), e.g. that a key went in a header and not the URL.
 */
export function fakeFetch(handler: (c: Call, n: number) => Reply | Promise<Reply>) {
  const calls: Call[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const c: Call = { url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: (init?.body as string) ?? null };
    calls.push(c);
    const r = await handler(c, calls.length);
    if (r instanceof Error) throw r;
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: { "content-type": "application/json", ...r.headers } });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

export const timeoutError = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
export const noSleep = async () => {};
