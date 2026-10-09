import { NextResponse } from "next/server";
import { jevConfig } from "@/lib/server/jev";
import { openaiConfig } from "@/lib/server/openai";
import { isStaff, staffMode } from "@/lib/server/session";
import { storeKind } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** What's turned on in this deployment. Never includes secrets. */
export async function GET() {
  return NextResponse.json({
    ai: { openai: openaiConfig().configured, jev: jevConfig().configured },
    store: storeKind(),
    staff: { mode: staffMode(), signedIn: await isStaff() },
  });
}
