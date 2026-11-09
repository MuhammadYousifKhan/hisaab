# Hisaab

**Team Aceva · Build for Campus 2026 · FinTech track · Challenge HS-0302**
*"A Micro-Lender: Transactions arrive through different channels"*

Borrowers with thin or no credit history repay a micro-lender through JazzCash, Easypaisa, Raast bank transfers and cash agents. The payments rarely line up with the installment they were meant for, or with the deposit that finally reaches the lender's bank. Hisaab:

- matches every payment to an installment and to a bank deposit
- puts anything it can't match safely into a review queue, with a typed reason
- explains every adjustment in plain English or Urdu
- keeps confirmed money apart from projections
- proves the books balance, both in the engine and in Postgres

All data is synthetic. Names, phone numbers and amounts are invented, and channel fee rates are test values.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
```

No database setup is needed. By default the app runs an embedded Postgres ([PGlite](https://pglite.dev)) that stores its data in `.data/pglite`. To use a hosted Postgres instead (Supabase, Neon, …), set `DATABASE_URL`. The schema and triggers are created or upgraded on first start; existing databases migrate in place.

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build && npm start` | Production build and server |
| `npm test` | Vitest suite: ledger invariants, property tests over random demo and live books, the "stored history is a prefix of every replay" property, a golden hash of the demo book, ingest and sign-in, and the Postgres guards |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |

### Configuration

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Hosted Postgres. Needed on Vercel, or data resets with the server. | embedded PGlite |
| `SESSION_SECRET` | Signs sign-in cookies. Set it in production. | fixed key in development; random per start in production |
| `OPS_USERNAME`, `OPS_PASSWORD`, `OPS_NAME` | The first staff account, created on the first start only. Later staff are added in the console. | development: `sana` / `hisaab-ops`. Production without `OPS_PASSWORD`: a random password, printed once in the server log. |
| `INGEST_TOKEN` | Bearer token for the webhooks and bank-statement API. | development: `hisaab-dev-ingest-token`. Production: webhooks refuse everything until set. |

## Two books

| | Demo book | Live book |
|---|---|---|
| Data | 12 synthetic borrowers and two months of payments with planted problems, generated from a seed | Starts empty. Borrowers and loans are entered by staff; payments arrive by webhook, file upload or the simulator |
| Date | Frozen at 9 Nov 2026 | Real date in Pakistan time (the simulator can move it forward) |
| Used for | The 3-minute pitch and the planted-vs-caught scorecard | The working app |

Staff open on the live book and switch with the **Live / Demo** control in the top bar. A borrower always sees the book they signed in to.

## Screens

| Path | For | What it shows |
|---|---|---|
| `/login` | Everyone | Borrowers sign in with phone + PIN; staff with username + password. Demo borrowers all use PIN `1234`. |
| `/borrower/…` | Borrowers | What I owe, where each payment is, why my balance changed, a repayment record, and a form to report a missing payment. English and Urdu (`?lang=ur`), mobile-first. A borrower can only open their own page; staff can open any (support view). |
| `/console` | Staff | Actual collections vs money in transit; a projection kept separate; review queue with one-click decisions recorded under the staff member's name; payments with a full trace; settlements; journal; **Borrowers & loans**; **Intake**. |
| `/simulate` | Staff | Test tooling for the live book: send a payment (from the borrower's phone, a relative's, or a stranger's), pay out a settlement batch with an optional shortfall, reverse a payment, move the clock forward. |
| `/proof` | Judges (no sign-in) | Engine and Postgres checks, live; planted problems vs what was caught (demo book); buttons that replay every file, attempt an unbalanced entry, and attempt to edit history. |
| `/blueprint` | The team | Challenge breakdown, architecture, ledger rules, data model. |

## Getting data in (live book)

- **Borrowers and loans:** Console › Borrowers & loans. A loan is weekly installments; the disbursement is posted to the journal when it is issued. Each borrower gets a PIN (generated and shown once, or chosen).
- **Webhooks:** `POST /api/channels/{easypaisa|jazzcash|raast|agent}` with `Authorization: Bearer $INGEST_TOKEN`. Body: one payload, or an array of up to 500. Answers `202` accepted, `200` repeat delivery, `422` quarantined (stored, with the validation message), `401` bad token. Payload shapes are the ones in `lib/ingest/payloads.ts`.
- **Bank statement:** `POST /api/bank/statement` with a JSON array of `{ date, time?, amount, narration, ref?, bank_ref? }`, or upload a CSV in Console › Intake. Only credits are taken. A line with a `bank_ref` (or identical date, amount, narration and ref) is stored once, so re-sending a statement adds nothing. A line whose `ref` is a settlement batch such as `EP-SETL-2026-11-08` or `RAAST-<id>` settles that batch; anything else is held as a deposit with no record.
- **Agent network file:** Console › Intake accepts the daily CSV (`receipt_no, agent_id, customer_ref, customer_name, amount, status, collected_at`).

Every input is stored exactly as received and numbered in arrival order. The journal is rebuilt from them, so the stored entries are always an exact prefix of any later replay.

## How it works

```
Seeded generator → channel adapters (Zod) → raw event store (append-only)
  → normalizer + dedupe gate → matcher → double-entry ledger → views
                                   └─ no safe match → review queue → recorded decision ─┘
```

- **Event-sourced.** Borrowers, loans, channel events, bank lines and human decisions (ops actions, borrower reports) are stored exactly as received. The journal is a deterministic projection of them. New entries are appended, and each stored entry carries a SHA-256 content hash. Replaying the inputs must reproduce every stored entry exactly, and the Proof page checks this.
- **Double-entry, integer paisa.** Every amount is a whole number of paisa. The engine's `post()` refuses an unbalanced entry, and so does Postgres: a deferred constraint trigger checks each entry at commit.
- **Append-only history.** Triggers reject `UPDATE` and `DELETE` on the journal, raw events, bank lines, decisions, borrowers and loans. Corrections are new reversing entries.
- **Matching.** Payments are matched by loan reference, then registered phone, then account name. Daily channel batches are settled against bank lines, where batch total − fee − reversals = deposit. A payment that reaches a batch after it settled goes into a follow-up batch (`…-2`). A payment that can't be matched safely goes to suspense with a typed review item; name similarity is only ever a suggestion.
- **Actual vs projection.** Projections come from a separate function, are drawn dashed and hatched, and are never posted or added to actual totals.

### Code map

| Area | Files |
|---|---|
| Ledger | `lib/engine/ledger.ts`, `lib/engine/proof.ts` |
| Data and adapters | `lib/engine/generate.ts`, `lib/engine/adapters.ts` |
| Matching and review | `lib/engine/pipeline.ts`, `lib/engine/explain.ts` |
| Views | `lib/engine/views.ts` |
| Database | `lib/db/schema.ts` (tables + triggers), `lib/db/store.ts`, `lib/db/client.ts` |
| Intake | `lib/ingest/` (payload shapes, CSV, files, one shared ingest path), `app/api/` |
| Sign-in | `lib/auth/` (scrypt, signed sessions, guards), `lib/db/people.ts`, `app/login/` |
| Screens | `app/borrower/[id]`, `app/console`, `app/simulate`, `app/proof`, `app/actions.ts`, `components/` |
| Tests | `tests/engine`, `live`, `db`, `db-live`, `ingest`, `demo-golden` |

## 3-minute demo

Use the **Demo** book. Sign in as staff, switch to Demo, and open the borrower app (staff can open any borrower).

1. **Borrower app as Shazia** (`/borrower/B02`). Her 6 Nov installment shows as not received, because she paid from her sister's phone. Open **Report**, tap **Fill in this demo's example**, and send.
2. **Lender console.** Her report is at the top of the review queue, already linked to the unmatched JazzCash payment. Apply it. The posted entry and its explanation appear.
3. **Back to Shazia, in Urdu** (`?lang=ur`). The payment is confirmed, with a one-line reason. Her on-time record counts the day she paid.
4. **Console.** Ali's split payment, the Easypaisa batch that arrived Rs 150 short, and the projection panel kept apart from the actual figures.
5. **Proof.** All checks pass. **Replay every file** inserts nothing. **Try an unbalanced entry** and **Try to edit a posted entry** are both rejected by Postgres.

To start over with a clean review history, use **New demo book** on the Proof page (staff only). Old books stay in the database untouched.

### A live walkthrough

1. Sign in as staff. Console › Borrowers & loans: add a borrower with a mobile number, then issue a loan.
2. Simulator: send a JazzCash payment **from the borrower** (applied by phone), then one **from another number** (held for review).
3. Console › Review queue: apply the held payment to the borrower. The entry is posted under your name.
4. Simulator: pay out the Easypaisa/JazzCash batch **Rs 150 short**; it appears in the queue with the gap booked as a claim. Move the clock forward a day to see installments fall due.
5. Sign out, sign in as the borrower with phone + PIN, and see every step in plain words.
6. Proof: all checks pass on the live book.

## Deploying

The app runs anywhere Node.js does. On Vercel, set `DATABASE_URL` to a hosted Postgres so data survives between requests (without it, the embedded database lives in `/tmp` and resets whenever the server restarts), and set `SESSION_SECRET`, `OPS_USERNAME`, `OPS_PASSWORD` and `INGEST_TOKEN`. Sign-in cookies are marked `Secure` in production, so serve it over HTTPS.

The simulator is test tooling and stays available to staff. Real Easypaisa, JazzCash and Raast connections replace it by posting to the webhook addresses above; nothing else changes.
