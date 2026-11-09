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

No database setup is needed. By default the app runs an embedded Postgres ([PGlite](https://pglite.dev)) that stores its data in `.data/pglite`. To use a hosted Postgres instead (Supabase, Neon, …), set `DATABASE_URL`. The schema and triggers are created on first start.

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build && npm start` | Production build and server |
| `npm test` | Vitest suite: ledger invariants, a property test over random seeds, the scripted stories, the end-to-end demo flow, and the Postgres guards |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |

## Screens

| Path | For | What it shows |
|---|---|---|
| `/borrower/B01` … `B12` | Borrowers | What I owe, where each payment is, why my balance changed, a repayment record, and a form to report a missing payment. English and Urdu (`?lang=ur`), mobile-first. |
| `/console` | Lender operations | Actual collections vs money in transit; a projection kept separate; review queue with one-click decisions; payments with a full trace; settlements; journal. |
| `/proof` | Judges | 9 engine checks and 5 Postgres checks, live; planted problems vs what was caught; buttons that replay every file, attempt an unbalanced entry, and attempt to edit history. |
| `/blueprint` | The team | Challenge breakdown, architecture, ledger rules, data model. |

## How it works

```
Seeded generator → channel adapters (Zod) → raw event store (append-only)
  → normalizer + dedupe gate → matcher → double-entry ledger → views
                                   └─ no safe match → review queue → recorded decision ─┘
```

- **Event-sourced.** Channel events, bank lines and human decisions (ops actions, borrower reports) are stored exactly as received. The journal is a deterministic projection of them. New entries are appended, and each stored entry carries a SHA-256 content hash. Replaying the inputs must reproduce every stored entry exactly, and the Proof page checks this.
- **Double-entry, integer paisa.** Every amount is a whole number of paisa. The engine's `post()` refuses an unbalanced entry, and so does Postgres: a deferred constraint trigger checks each entry at commit.
- **Append-only history.** Triggers reject `UPDATE` and `DELETE` on the journal, raw events, bank lines and decisions. Corrections are new reversing entries.
- **Matching.** Payments are matched by loan reference, then registered phone, then account name. Daily channel batches are settled against bank lines, where batch total − fee − reversals = deposit. A payment that can't be matched safely goes to suspense with a typed review item; name similarity is only ever a suggestion.
- **Actual vs projection.** Projections come from a separate function, are drawn dashed and hatched, and are never posted or added to actual totals.

### Code map

| Area | Files |
|---|---|
| Ledger | `lib/engine/ledger.ts`, `lib/engine/proof.ts` |
| Data and adapters | `lib/engine/generate.ts`, `lib/engine/adapters.ts` |
| Matching and review | `lib/engine/pipeline.ts`, `lib/engine/explain.ts` |
| Views | `lib/engine/views.ts` |
| Database | `lib/db/schema.ts` (tables + triggers), `lib/db/store.ts`, `lib/db/client.ts` |
| Screens | `app/borrower/[id]`, `app/console`, `app/proof`, `app/actions.ts`, `components/` |
| Tests | `tests/engine.test.ts`, `tests/db.test.ts` |

## 3-minute demo

1. **Borrower app as Shazia** (`/borrower/B02`). Her 6 Nov installment shows as not received, because she paid from her sister's phone. Open **Report**, tap **Fill in this demo's example**, and send.
2. **Lender console.** Her report is at the top of the review queue, already linked to the unmatched JazzCash payment. Apply it. The posted entry and its explanation appear.
3. **Back to Shazia, in Urdu** (`?lang=ur`). The payment is confirmed, with a one-line reason. Her on-time record counts the day she paid.
4. **Console.** Ali's split payment, the Easypaisa batch that arrived Rs 150 short, and the projection panel kept apart from the actual figures.
5. **Proof.** All checks pass. **Replay every file** inserts nothing. **Try an unbalanced entry** and **Try to edit a posted entry** are both rejected by Postgres.

To start over with a clean review history, use **Start new book** on the Proof page. Old books stay in the database untouched.

## Deploying

The app runs anywhere Node.js does. On Vercel, set `DATABASE_URL` to a hosted Postgres so data survives between requests. Without it, the embedded database lives in `/tmp` and resets whenever the server restarts.
