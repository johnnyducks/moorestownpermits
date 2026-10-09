import { NextResponse } from "next/server";
import { StoreError } from "@/lib/server/store";

/** Turns a missing-storage error into a clear 503 instead of a bare 500. */
export function handled<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: 503 });
      throw e;
    }
  };
}
