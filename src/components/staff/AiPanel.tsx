"use client";

import type { AiReview } from "@/lib/permits/application";
import { STATUS_NAME } from "@/lib/permits/status";
import { fmtDate, Spinner } from "../ui";

export function AiPanel({ ai, enabled, busy, onRun, onUse }: {
  ai: AiReview | undefined;
  enabled: boolean;
  busy: boolean;
  onRun: () => void;
  onUse: (r: AiReview) => void;
}) {
  // Reviews saved before the decision engine was split out have no decidedBy; treat them as absent.
  const review = ai?.decidedBy ? ai : undefined;
  return (
    <div className="ai">
      <div className="aih">
        <div>
          <h3>AI review assistant</h3>
          <div className="muted small">Routes the application, scores completeness and drafts next steps. A reviewer makes every decision.</div>
        </div>
        <button className="btn dark sm" disabled={!enabled || busy} onClick={onRun}>
          {busy ? <><Spinner /> Reviewing</> : review ? "Run again" : "Run review"}
        </button>
      </div>
      <div className="aib">
        {review ? <Review x={review} onUse={onUse} /> : (
          <p className="muted small">
            {enabled
              ? "Run a review to get a routing call, a completeness score, missing items, the likely rehab category and a draft message to the applicant."
              : "AI review isn't set up on this server. Add JEV_API_KEY and/or OPENAI_API_KEY to turn it on."}
          </p>
        )}
      </div>
    </div>
  );
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

function Review({ x, onUse }: { x: AiReview; onUse: (r: AiReview) => void }) {
  const n = x.narrative;
  const d = x.decidedBy;
  const probs = d.probabilities ? Object.entries(d.probabilities).sort((a, b) => b[1] - a[1]) : [];
  return (
    <>
      <div className="meter"><b>{x.completeness}</b><div className="track"><i style={{ width: `${x.completeness}%` }} /></div><span className="muted small">completeness</span></div>
      <div className="grid2">
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Route to</div>
          <p><b>{x.routeTo}</b>{d.confidence != null && <span className="muted small"> · {pct(d.confidence)} confidence</span>}</p>
          {probs.length > 1 && (
            <p className="small muted mono" style={{ marginTop: 4 }}>{probs.map(([k, v]) => `${k} ${pct(v)}`).join(" · ")}</p>
          )}
        </div>
        {n && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Classification</div>
            <p className="small">{n.rehabCategory}{n.rehabCite && <> <span className="mono muted">({n.rehabCite})</span></>}</p>
            <div className="disc" style={{ marginTop: 8 }}>{n.disciplines.map((t) => <span key={t} className="pill">{t}</span>)}</div>
            {n.priorApprovals.length > 0 && <p className="small muted" style={{ marginTop: 6 }}>Prior approvals: {n.priorApprovals.join(", ")}</p>}
          </div>
        )}
      </div>
      {n && <p>{n.summary}</p>}
      {n && n.missing.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Missing or unclear</div>
          <ul>{n.missing.map((m, i) => <li key={i}><b>{m.item}</b>{m.why && <> · <span className="muted">{m.why}</span></>}</li>)}</ul>
        </div>
      )}
      {n && n.flags.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Reviewer flags</div>
          <ul>{n.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </div>
      )}
      {n && <div><div className="eyebrow" style={{ marginBottom: 8 }}>Recommended next step</div><p className="small">{n.nextStep}</p></div>}
      <div>
        {n?.messageToApplicant && (
          <>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Draft message to applicant</div>
            <div className="draft">{n.messageToApplicant}</div>
          </>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={() => onUse(x)}>
            Use suggestion: {STATUS_NAME[x.suggestedStatus]}{n?.messageToApplicant ? " + message" : ""}
          </button>
        </div>
      </div>
      {x.note && <div className="note plain small">{x.note}</div>}
      <p className="muted small mono">
        Reviewed {fmtDate(x.at)} · call by {d.engine === "jev" ? "Jev" : "OpenAI"} ({d.model}){n && ` · write-up by OpenAI (${n.model})`}
      </p>
    </>
  );
}
