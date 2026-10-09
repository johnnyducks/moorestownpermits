import { NextResponse } from "next/server";
import { allow, clientKey } from "@/lib/server/limit";
import { askStream, openaiConfig } from "@/lib/server/openai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Homeowner Q&A. Streams plain text. */
export async function POST(req: Request) {
  if (!openaiConfig().configured) return NextResponse.json({ error: "Answers aren't available right now." }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (!question) return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  if (!(await allow("ask:" + clientKey(req), 10, 60_000))) {
    return NextResponse.json({ error: "Too many questions at once. Try again in a minute." }, { status: 429 });
  }
  return new Response(askStream(question, req.signal), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
