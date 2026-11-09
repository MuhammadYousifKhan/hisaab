# Hisaab

A micro-lender's repayments arrive through JazzCash, Easypaisa, Raast and cash agents. Hisaab matches each payment to an installment and to a bank deposit, holds anything it can't match safely for review, explains every adjustment in English or Urdu, keeps confirmed money apart from projections, and proves the books balance.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
```

No database setup is needed: by default the app runs an embedded Postgres ([PGlite](https://pglite.dev)) in `.data/pglite`. Set `DATABASE_URL` to use a hosted Postgres (Supabase, Neon, …). The schema and triggers are created or upgraded on first start.

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build && npm start` | Production build and server |
| `npm test` | Test suite |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Hosted Postgres. Needed on Vercel, or data resets with the server. | embedded PGlite |
| `SESSION_SECRET` | Signs sign-in cookies. | fixed key in development; random per start in production |
| `OPS_USERNAME`, `OPS_PASSWORD`, `OPS_NAME` | The first staff account, created on first start only. | development: `sana` / `hisaab-ops`. Production without `OPS_PASSWORD`: a random password printed once in the server log. |
| `INGEST_TOKEN` | Bearer token for the webhooks and bank-statement API. | development: `hisaab-dev-ingest-token`. Production: webhooks refuse everything until set. |

## Using it

**Apply** at `/apply` (no sign-in, no credit history needed): name, mobile number, work, amount, weeks and a PIN. Staff approve or decline in Console › Borrowers & loans; approving opens the account with the applicant's own PIN and issues the loan.

**Sign in** at `/login`. One form: a mobile number and PIN opens a borrower's account; a username and password opens the lender console. An applicant who signs in before approval is told the application is still being reviewed.

### Test accounts

| Role | Sign in with | Password / PIN |
|---|---|---|
| Lender staff | username `sana` | `hisaab-ops` |
| Borrower | the mobile number on the account | the PIN chosen when applying, or set by staff |
| Sandbox borrowers | the numbers listed after running the sandbox scenario | `1234` |

The staff account is created on the first start of a database. Locally (`npm run dev`) it exists automatically. On a hosted deployment, set `OPS_USERNAME=sana` and `OPS_PASSWORD=hisaab-ops` **before the first start**, or the app generates a random password and prints it once in the server log. These are shared test credentials for reviewers; replace them before any real use.

To try the borrower side: apply at `/apply` with any mobile number and a PIN, sign in as staff and approve the application in Console › Borrowers & loans, then sign in with that number and PIN. Or run the sandbox scenario (below) and use one of its borrowers.

**Staff**
1. Console › Borrowers & loans: add a borrower (a mobile number and a PIN), then issue a loan. The disbursement is posted to the journal.
2. Payments arrive by webhook, by file upload (Console › Intake), or from the Simulator, which stands in for the channels and the bank until they are connected.
3. Console › Review queue: anything that couldn't be matched safely waits here. Each decision is recorded under the signed-in staff member.

**Borrowers** see what they owe, where each payment is, why the balance changed, a repayment record, and can report a missing payment. English and Urdu.

**Sandbox scenario.** Simulator › Run sandbox scenario adds four sandbox borrowers and sends one of every payment situation through the real intake: normal, repeat delivery, paid twice, failed, partial, overpaid, reversed, paid from an unknown phone (with the borrower's report), wrong loan reference, pending, malformed, bank deposit with no record, short, over, exact and missing settlements. It then checks each one and lists the result. The Simulator can also send any single event on its own.

**Proof** (`/proof`, no sign-in) shows the ledger checks, live. On an empty book it says so; run the sandbox scenario first.

## Getting data in

- **Webhooks:** `POST /api/channels/{easypaisa|jazzcash|raast|agent}` with `Authorization: Bearer $INGEST_TOKEN`. One payload, or an array of up to 500. Answers `202` accepted, `200` repeat delivery, `422` quarantined, `401` bad token. Payload shapes are in `lib/ingest/payloads.ts`.
- **Bank statement:** `POST /api/bank/statement` with a JSON array of `{ date, time?, amount, narration, ref?, bank_ref? }`, or upload a CSV in Console › Intake. Only credits are taken. Re-sending a statement adds nothing. A `ref` such as `EP-SETL-2026-11-08` or `RAAST-<id>` settles that batch; any other credit is held as a deposit with no record.
- **Agent file:** Console › Intake takes the daily CSV (`receipt_no, agent_id, customer_ref, customer_name, amount, status, collected_at`).

## How it works

```
Webhooks / uploads → channel adapters (Zod) → raw event store (append-only)
  → normalizer + dedupe gate → matcher → double-entry ledger → views
                                   └─ no safe match → review queue → recorded decision ─┘
```

- **Event-sourced.** Borrowers, loans, channel events, bank lines and human decisions are stored exactly as received, each numbered in arrival order. The journal is rebuilt from them, so the stored entries are always an exact prefix of any later replay. Each stored entry carries a SHA-256 hash, which the Proof page checks.
- **Double-entry, integer paisa.** The engine's `post()` refuses an unbalanced entry, and so does Postgres: a deferred constraint trigger checks each entry at commit.
- **Append-only.** Triggers reject `UPDATE` and `DELETE` on the journal, raw events, bank lines, decisions, borrowers and loans. Corrections are new reversing entries.
- **Matching.** By loan reference, then registered phone, then account name (never when two borrowers share a name). Daily channel batches are settled against bank lines: batch total − fee − reversals = deposit. A payment that reaches a batch after it settled goes into a follow-up batch (`…-2`).
- **Actual vs projection.** Projections come from a separate function, are drawn dashed and hatched, and are never posted or added to actual totals.

| Area | Files |
|---|---|
| Ledger and matching | `lib/engine/` |
| Database | `lib/db/` (tables and triggers in `schema.ts`) |
| Intake | `lib/ingest/`, `app/api/` |
| Sign-in | `lib/auth/`, `app/login/` |
| Screens | `app/borrower`, `app/console`, `app/simulate`, `app/proof`, `components/` |
| Tests | `tests/` |

## Deploying

On Vercel, set `DATABASE_URL` to a hosted Postgres (otherwise data resets with the server), and set `SESSION_SECRET`, `OPS_USERNAME`, `OPS_PASSWORD` and `INGEST_TOKEN`. Sign-in cookies are `Secure` in production, so serve it over HTTPS. Real Easypaisa, JazzCash and Raast connections replace the Simulator by posting to the webhook addresses above.
