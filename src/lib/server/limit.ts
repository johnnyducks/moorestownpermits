/**
 * Rate limits (fixed window per key) that keep one client from running up the
 * AI bill or flooding the queue. Counted in Postgres when it's in use, so the
 * limit holds across serverless instances; in memory otherwise.
 */
import { postgresStore } from "./store.ts";

const windows = new Map<string, { start: number; count: number }>();

export function allowInMemory(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return true;
  }
  if (w.count >= max) return false;
  w.count++;
  return true;
}

export async function allow(key: string, max: number, windowMs: number): Promise<boolean> {
  const pg = postgresStore();
  if (!pg) return allowInMemory(key, max, windowMs);
  try {
    return await pg.allow(key, max, windowMs);
  } catch (e) {
    console.error("rate limit check failed, using memory:", e);
    return allowInMemory(key, max, windowMs);
  }
}

/** Client address for rate limiting. On Vercel, x-forwarded-for is set by the platform. */
export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
