/**
 * OpenAI calls (Responses API): the homeowner Q&A, streamed as text, and the
 * written part of the staff review, as strict JSON. SERVER ONLY; the key never
 * reaches the browser.
 */
import OpenAI from "openai";
import { KB } from "../permits/kb.ts";
import { OFFICE_PHONE } from "../permits/links.ts";

export function openaiConfig() {
  const apiKey = process.env.OPENAI_API_KEY || "";
  return { apiKey, configured: apiKey.length > 0, model: process.env.OPENAI_MODEL || "gpt-5" };
}

let client: OpenAI | null = null;
const getClient = () => (client ??= new OpenAI({ apiKey: openaiConfig().apiKey, timeout: 120_000, maxRetries: 2 }));

/** Reasoning effort only applies to reasoning models (gpt-5 family, o-series). */
const reasoning = (model: string, effort: "low" | "medium") => (/^(gpt-5|o\d)/.test(model) ? { reasoning: { effort } } : {});

/* ---------- Homeowner Q&A ---------- */

const ASK_INSTRUCTIONS = `You answer homeowner questions for the Moorestown Township, NJ Construction Office permit portal. Use only the guide below. Be warm, plain and brief: 2 to 5 short sentences, no headings, no markdown, no bullet lists unless listing forms. If the answer depends on specifics, say so and suggest calling the office. Never state a fee amount. Don't invent rules. If the question isn't about permits, construction or the office, say you can only help with permit questions.

GUIDE:
${KB}`;

export const ASK_FALLBACK = `Couldn't get an answer just now. Call the office at ${OFFICE_PHONE}.`;

/** Streams the answer as plain text. Errors end the stream with a fallback line. */
export function askStream(question: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const { model } = openaiConfig();
  return new ReadableStream({
    async start(controller) {
      let sent = false;
      const send = (t: string) => {
        controller.enqueue(enc.encode(t));
        sent = true;
      };
      try {
        const stream = await getClient().responses.create(
          { model, instructions: ASK_INSTRUCTIONS, input: question, max_output_tokens: 4000, stream: true, ...reasoning(model, "low") },
          { signal },
        );
        let incomplete = false;
        for await (const ev of stream) {
          if (ev.type === "response.output_text.delta") send(ev.delta);
          else if (ev.type === "response.refusal.delta") incomplete = true;
          else if (ev.type === "response.incomplete" || ev.type === "response.failed") incomplete = true;
        }
        if (incomplete || !sent) send(sent ? `\n\n${ASK_FALLBACK}` : ASK_FALLBACK);
      } catch (e) {
        if (!signal.aborted) {
          console.error("ask failed:", e instanceof OpenAI.APIError ? `${e.status} ${e.message}` : e);
          send(sent ? `\n\n${ASK_FALLBACK}` : ASK_FALLBACK);
        }
      }
      controller.close();
    },
  });
}

/* ---------- Structured output ---------- */

export class OutputError extends Error {}

/** One strict-JSON call. The schema must be OpenAI strict-mode compatible. */
export async function jsonResponse<T>(opts: { name: string; instructions: string; input: string; schema: Record<string, unknown> }): Promise<{ value: T; model: string }> {
  const { model } = openaiConfig();
  const res = await getClient().responses.create({
    model,
    instructions: opts.instructions,
    input: opts.input,
    max_output_tokens: 16000,
    text: { format: { type: "json_schema", name: opts.name, schema: opts.schema, strict: true } },
    ...reasoning(model, "medium"),
  });
  if (res.status === "incomplete") throw new OutputError("The review was cut off. Try again.");
  if (!res.output_text) throw new OutputError("The review was declined or empty. Review this one by hand.");
  try {
    return { value: JSON.parse(res.output_text) as T, model: res.model };
  } catch {
    throw new OutputError("The review didn't come back cleanly. Try again.");
  }
}

export { OpenAI };
