/**
 * Minimal client for the Jev System One API (POST /v1/systemone), a decision
 * classifier: it answers choice / score / yes-no questions about a state with
 * calibrated probabilities. SERVER ONLY.
 */
const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 2;

export function jevConfig() {
  const apiKey = process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY || "";
  return {
    apiKey,
    configured: apiKey.length > 0,
    model: process.env.JEV_MODEL || "jev-latest",
    base: (process.env.JEV_API_BASE || "https://api.typesafe.ai").replace(/\/+$/, ""),
  };
}

type Describable = string | Record<string, unknown> | unknown[];

export type JevQuestion =
  | { type: "choice"; instructions?: Describable; criteria: Record<string, Describable> }
  | { type: "score"; instructions?: Describable; criteria: Describable[] };

export interface ChoiceAnswer { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
export interface ScoreAnswer { type: "score"; score: number; confidence: number; probabilities: Record<string, number> }
export type JevAnswer = ChoiceAnswer | ScoreAnswer;

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
}

export class JevError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
    this.name = "JevError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asks Jev the questions about `state`. One retry on 429 / 529 / 5xx / network failure. */
export async function evaluate(state: Record<string, unknown>, questions: Record<string, JevQuestion>): Promise<JevResponse> {
  const cfg = jevConfig();
  if (!cfg.configured) throw new JevError("JEV_API_KEY is not set on the server.");
  const body = JSON.stringify({ model: cfg.model, state, questions });
  let last: JevError | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return check(await once(cfg.base, cfg.apiKey, body), questions);
    } catch (e) {
      last = e instanceof JevError ? e : new JevError("Could not reach the Jev API.", true);
      if (!last.retryable || attempt === MAX_ATTEMPTS) break;
      await sleep(600 * attempt);
    }
  }
  throw last!;
}

async function once(base: string, apiKey: string, body: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${base}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new JevError(timeout ? `Jev did not respond within ${TIMEOUT_MS / 1000}s.` : "Could not reach the Jev API.", true);
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new JevError("Jev rejected the API key.");
    if (res.status === 422) throw new JevError(`Jev rejected the request: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    throw new JevError(`Jev returned HTTP ${res.status}.`, res.status === 429 || res.status >= 500);
  }
  try {
    return await res.json();
  } catch {
    throw new JevError("Jev returned a non-JSON response.");
  }
}

/** Validates the response strictly; missing values are never filled in. */
function check(json: unknown, questions: Record<string, JevQuestion>): JevResponse {
  const r = json as Partial<JevResponse> | null;
  if (!r || typeof r.model !== "string" || !r.answers || typeof r.answers !== "object") {
    throw new JevError("Jev response is missing `model` or `answers`.");
  }
  for (const [name, q] of Object.entries(questions)) {
    const a = r.answers[name] as unknown as { type?: string; confidence?: unknown; probabilities?: unknown; choice?: unknown; score?: unknown } | undefined;
    const ok = !!a && a.type === q.type && typeof a.confidence === "number" && a.probabilities && typeof a.probabilities === "object" &&
      (q.type === "choice" ? typeof a.choice === "string" && Object.hasOwn(q.criteria, a.choice) : typeof a.score === "number");
    if (!ok) throw new JevError(`Jev answer for "${name}" is missing or malformed.`);
  }
  return r as JevResponse;
}
