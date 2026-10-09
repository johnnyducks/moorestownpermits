# Moorestown Permits

A proof-of-concept residential permit portal for the Moorestown Township, NJ Construction Office, built by the Moorestown AI Task Force for Township officials to review. It sits alongside the official [SDL portal](https://www.sdlportal.com) and doesn't replace it. Submissions here are not official permit applications.

Homeowners answer a few questions and get a permit plan: which technical sections, plans, prior approvals, documents and inspections their project needs. They can then submit and track the application. Staff work the queue, run an AI intake review and send status updates.

## Deploy on Vercel

1. Import this repository in Vercel. The framework preset is Next.js, and no build settings need to change.
2. **Add a database.** Under Storage, add Neon (Postgres). It sets `DATABASE_URL` for the project. A Supabase connection string in `DATABASE_URL` works too. The tables are created on first use; `db/schema.sql` has them if you'd rather create them yourself.
3. **Set environment variables** (Settings → Environment Variables):

   | Variable | Required | Purpose |
   | --- | --- | --- |
   | `DATABASE_URL` | yes | Postgres (set by the Neon integration; `POSTGRES_URL` is also accepted) |
   | `STAFF_ACCESS_KEY` | yes | Key reviewers use to sign in at `/staff`. Without it the console is off in production |
   | `SESSION_SECRET` | recommended | Signs cookies. Generate one with `openssl rand -hex 32`. If it's unset, a key is derived from `DATABASE_URL` |
   | `OPENAI_API_KEY` | for AI | Homeowner Q&A and the written review |
   | `OPENAI_MODEL` | no | Default `gpt-5` |
   | `JEV_API_KEY` | for AI | Jev makes the review's routing call and completeness score |
   | `JEV_MODEL`, `JEV_API_BASE` | no | Defaults `jev-latest`, `https://api.typesafe.ai` |

4. Deploy. Open `/staff`, sign in, and click **Load example applications** to try the console.

The AI review allows up to 300 seconds (`maxDuration`), which needs Fluid Compute (on by default for new projects). Without it, Hobby plans cap functions at 60 seconds.

## Run locally

```bash
npm install
cp .env.example .env.local   # all optional locally
npm run dev                  # http://localhost:3000
```

Without `DATABASE_URL`, applications are saved to `./.data/applications.json`. Without `STAFF_ACCESS_KEY`, the staff console is open in development. AI features hide or disable themselves when their keys are missing.

## How the AI is used

| Feature | Engine | Notes |
| --- | --- | --- |
| Ask a question (Guide) | OpenAI | Streamed. Grounded only in the Township's homeowner guide (`src/lib/permits/kb.ts`). Never quotes fees |
| Review: routing and completeness | **Jev** | Two questions about the application: a choice between *Zoning*, *Plan review* and *Return to applicant*, and a 0–4 completeness score. The panel shows Jev's confidence and the probability of each route |
| Review: write-up | OpenAI | Summary, rehab category, technical sections, missing items, flags, next step and a draft message, all written to match Jev's call. Strict JSON schema |

Either engine can work alone. With only OpenAI, it also makes the routing call. With only Jev, you get the call without the write-up. If Jev is down, OpenAI makes the call and the panel says so. The engines never see owner names, emails, phone numbers or addresses. The examiner makes every decision: **Use suggestion** only fills in the status form.

## How it's built

```
src/lib/permits/   pure rules and records, shared by server and browser (unit-tested)
  plan.ts          computePlan(): answers → permit plan (identical to the v1 prototype)
  application.ts   record types, submission validation, applicant view, status updates
src/lib/server/    server-only
  store.ts         ApplicationStore; Postgres when DATABASE_URL is set, a JSON file locally
  postgres.ts      Postgres store and shared rate-limit counters
  session.ts       applicant cookie, staff sign-in
  openai.ts        Q&A stream, structured output
  jev.ts           Jev System One client
  review.ts        the intake review: Jev's call + OpenAI's write-up
src/app/api/       route handlers
src/components/    React UI
prototype/         the v1 single-file prototype and its handoff notes
```

**Trust boundaries**

- The server recomputes the permit plan from the submitted answers and validates everything else.
- Applicants see their own applications only, with no owner details, internal notes, history or AI review.
- Staff routes require the staff cookie.
- Q&A, submissions, reviews and sign-in attempts are rate-limited per client address. The counters live in Postgres, so the limits hold across serverless instances.

## Not done yet

1. **Identity.** "My applications" is tied to a browser cookie, and all staff share one key. Next step: magic-link email for homeowners and a staff account per reviewer, so the history records who did what.
2. **Uploads.** Only file names are recorded. Next step: Vercel Blob or Supabase Storage, with the review reading the documents.
3. **Notifications.** Applicants aren't emailed when their status changes.
4. **Rules.** The Construction Office should verify `computePlan()`. Shed (200 sq ft) and fence (6 ft) exemptions and some of the siding and window guidance are hedged.
5. **SDL.** There's no integration or export path yet.

## Checks

```bash
npm test                     # rules, validation, status flow
TEST_DATABASE_URL=postgres://… npm test   # also runs the Postgres store tests
npm run typecheck
npm run build
```
