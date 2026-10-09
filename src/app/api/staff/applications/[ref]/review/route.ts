import { NextResponse } from "next/server";
import { handled } from "@/app/api/handle";
import { allow, clientKey } from "@/lib/server/limit";
import { OpenAI, OutputError } from "@/lib/server/openai";
import { reviewApplication, reviewAvailable, ReviewError } from "@/lib/server/review";
import { getStore } from "@/lib/server/store";
import { staffOnly } from "../../../guard";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Run the AI intake review and save it with the application. */
export const POST = handled(async (req: Request, { params }: { params: Promise<{ ref: string }> }) => {
  const denied = await staffOnly();
  if (denied) return denied;
  if (!reviewAvailable()) return NextResponse.json({ error: "AI review isn't set up on this server." }, { status: 503 });
  if (!(await allow("review:" + clientKey(req), 20, 60 * 60_000))) {
    return NextResponse.json({ error: "Too many reviews at once. Try again shortly." }, { status: 429 });
  }
  const store = getStore();
  const app = await store.get((await params).ref);
  if (!app) return NextResponse.json({ error: "No such application." }, { status: 404 });

  try {
    const ai = await reviewApplication(app);
    // Re-read so a status update made while the review ran isn't lost.
    const latest = (await store.get(app.ref)) ?? app;
    const next = { ...latest, ai, updatedAt: Date.now() };
    await store.put(next);
    return NextResponse.json({ application: next });
  } catch (e) {
    if (e instanceof ReviewError || e instanceof OutputError) return NextResponse.json({ error: e.message }, { status: 502 });
    if (e instanceof OpenAI.RateLimitError) return NextResponse.json({ error: "Too many reviews at once. Try again shortly." }, { status: 429 });
    console.error("review failed:", e instanceof OpenAI.APIError ? `${e.status} ${e.message}` : e);
    return NextResponse.json({ error: "The review didn't come back cleanly. Try again." }, { status: 502 });
  }
});
