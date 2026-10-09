/**
 * The staff intake review. Two engines, each optional:
 *
 * - Jev (decision classifier) makes the call: where the application goes next
 *   and how complete it is, with calibrated probabilities.
 * - OpenAI writes it up: summary, classification, missing items, flags and a
 *   draft message to the applicant, consistent with Jev's call.
 *
 * With only OpenAI, it makes the call too. With only Jev, the review has the
 * call and no write-up. The examiner makes every decision. SERVER ONLY.
 */
import { type AiReview, type Application, type ReviewNarrative, type Route, ROUTE_STATUS, ROUTES } from "../permits/application.ts";
import { KB } from "../permits/kb.ts";
import { DISC, projectNames, QUESTIONS } from "../permits/projects.ts";
import { evaluate, jevConfig, type JevQuestion } from "./jev.ts";
import { jsonResponse, openaiConfig } from "./openai.ts";

export const reviewAvailable = () => jevConfig().configured || openaiConfig().configured;

export class ReviewError extends Error {}

/** What the engines see: the application without ids, contact details, history or prior reviews. */
export function reviewPayload(a: Application) {
  return {
    ref: a.ref,
    projects: projectNames(a.projects),
    description: a.description,
    estimatedCost: a.cost,
    ownerOccupiedSingleFamily: a.answers.ownerOcc,
    workBy: a.answers.doer,
    contractor: a.contractor || null,
    plansBy: a.answers.plansBy,
    scopeAnswers: Object.fromEntries(QUESTIONS.filter((q) => a.answers[q.k]).map((q) => [q.t, a.answers[q.k]])),
    portalAssessment: { ...a.plan, disc: a.plan.disc.map((k) => DISC[k][0]) },
    documents: a.plan.docs.map((d) => ({ item: d.n, markedReady: !!a.docs[d.id]?.ready, files: a.docs[d.id]?.files ?? [] })),
  };
}

/* ---------- Jev: the decision ---------- */

const JEV_ROUTE: Record<string, Route> = { zoning: "Zoning", plan_review: "Plan review", return_to_applicant: "Return to applicant" };

const JEV_QUESTIONS: Record<string, JevQuestion> = {
  route: {
    type: "choice",
    instructions: "You are routing a residential construction permit application at intake in the Moorestown Township, NJ Construction Office. Decide where it goes next. Zoning approval, when required, comes before construction plan review.",
    criteria: {
      zoning: "portalAssessment.zoning is \"yes\" and the application is complete enough to send to the Zoning Office.",
      plan_review: "Zoning is not required (portalAssessment.zoning is \"no\" or \"check\" with nothing pointing to zoning) and the application is complete enough for construction plan review.",
      return_to_applicant: "Required documents are missing or not marked ready, the description is too thin to review, or answers (\"Not sure\", licensing, who prepares plans) need the applicant to clarify before review can start.",
    },
  },
  completeness: {
    type: "score",
    instructions: "How complete is the application packet, judged against the documents listed and the clarity of the description?",
    criteria: [
      "Most required documents are missing, including the permit application.",
      "The permit application is there but most other required documents are missing.",
      "About half of the required documents are ready.",
      "Most required documents are ready, with one or two gaps.",
      "Every required document is marked ready and the description clearly explains the work.",
    ],
  },
};

type Decision = Pick<AiReview, "routeTo" | "completeness" | "decidedBy">;

async function jevDecision(a: Application): Promise<Decision> {
  const res = await evaluate(reviewPayload(a), JEV_QUESTIONS);
  const route = res.answers.route;
  const comp = res.answers.completeness;
  if (route.type !== "choice" || comp.type !== "score") throw new ReviewError("Jev returned unexpected answer types.");
  const routeTo = JEV_ROUTE[route.choice];
  const levels = (JEV_QUESTIONS.completeness as Extract<JevQuestion, { type: "score" }>).criteria.length - 1;
  return {
    routeTo,
    completeness: Math.round((Math.max(0, Math.min(levels, comp.score)) / levels) * 100),
    decidedBy: {
      engine: "jev",
      model: res.model,
      confidence: route.confidence,
      probabilities: Object.fromEntries(Object.entries(route.probabilities).map(([k, v]) => [JEV_ROUTE[k] ?? k, v])),
    },
  };
}

/* ---------- OpenAI: the write-up ---------- */

const str = { type: "string" };
const strs = { type: "array", items: str };
const NARRATIVE_PROPS = {
  summary: str,
  rehabCategory: { type: "string", enum: ["Ordinary maintenance", "Repair", "Renovation", "Alteration", "Reconstruction", "Addition / new construction"] },
  rehabCite: str,
  disciplines: { type: "array", items: { type: "string", enum: ["Building", "Electrical", "Plumbing", "Mechanical", "Fire"] } },
  priorApprovals: strs,
  missing: { type: "array", items: { type: "object", additionalProperties: false, required: ["item", "why"], properties: { item: str, why: str } } },
  flags: strs,
  nextStep: str,
  messageToApplicant: str,
};
const DECISION_PROPS = { routeTo: { type: "string", enum: [...ROUTES] }, completeness: { type: "integer" } };

const schema = (props: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });

const INSTRUCTIONS = `You assist a plans examiner at the Moorestown Township, New Jersey Construction Office with intake of residential permit applications under the NJ Uniform Construction Code (N.J.A.C. 5:23). Review the application for completeness and routing. Be practical and specific; do not invent facts about the property. The examiner makes all decisions.

Field guidance:
- summary: one or two sentences on what this application is and its overall state.
- rehabCite: the N.J.A.C. citation for the category.
- priorApprovals: e.g. "Zoning", "Floodplain administrator"; empty if none.
- missing: each item a short name and a short reason.
- flags: short notes on code or licensing concerns worth a closer look (e.g. contractor doing trade work without license info, owner-prepared plans on a non-owner-occupied home, cost that looks low for the scope, scope answers marked "Not sure").
- nextStep: one sentence for the examiner.
- messageToApplicant: a short, friendly, plain-language message (under 90 words) the examiner could send, listing what's needed or what happens next. Sign it "Moorestown Construction Office".
- completeness (when asked): 0 to 100.

Office reference:
${KB}`;

async function writeUp(a: Application, decided: { routeTo: Route; completeness: number } | null) {
  const input = decided
    ? `The intake classifier has already decided: route to "${decided.routeTo}", packet about ${decided.completeness}% complete. Write the review consistent with that decision; do not argue with it. If something seems to contradict it, put that in flags.\n\nApplication (JSON):\n${JSON.stringify(reviewPayload(a), null, 1)}`
    : `Application (JSON):\n${JSON.stringify(reviewPayload(a), null, 1)}`;
  type Out = Omit<ReviewNarrative, "model"> & { routeTo?: Route; completeness?: number };
  return jsonResponse<Out>({ name: "intake_review", instructions: INSTRUCTIONS, input, schema: schema(decided ? NARRATIVE_PROPS : { ...NARRATIVE_PROPS, ...DECISION_PROPS }) });
}

/* ---------- Together ---------- */

export async function reviewApplication(a: Application): Promise<AiReview> {
  const useJev = jevConfig().configured;
  const useOpenAI = openaiConfig().configured;
  if (!useJev && !useOpenAI) throw new ReviewError("AI review isn't set up on this server.");

  let decision: Decision | null = null;
  let note: string | undefined;
  if (useJev) {
    try {
      decision = await jevDecision(a);
    } catch (e) {
      console.error("jev decision failed:", e);
      if (!useOpenAI) throw new ReviewError(`The decision engine didn't answer: ${(e as Error).message}`);
      note = "Jev was unavailable, so OpenAI made the routing call.";
    }
  }

  let narrative: ReviewNarrative | undefined;
  if (useOpenAI) {
    try {
      const { value, model } = await writeUp(a, decision);
      const { routeTo, completeness, ...rest } = value;
      narrative = { ...rest, model };
      if (!decision) {
        if (!routeTo || !ROUTES.includes(routeTo)) throw new ReviewError("The review didn't include a routing call. Try again.");
        decision = {
          routeTo,
          completeness: Math.max(0, Math.min(100, Math.round(Number(completeness) || 0))),
          decidedBy: { engine: "openai", model },
        };
      }
    } catch (e) {
      if (!decision) throw e;
      console.error("write-up failed:", e);
      note = "The written review couldn't be generated this time. The routing call stands.";
    }
  } else {
    note = "Add OPENAI_API_KEY for a written review and a draft message to the applicant.";
  }

  return { at: Date.now(), ...decision!, suggestedStatus: ROUTE_STATUS[decision!.routeTo], narrative, note };
}
