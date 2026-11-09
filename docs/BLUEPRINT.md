# Hisaab: Team Aceva blueprint (HS-0302)

**Build for Campus 2026 · FinTech track · Challenge HS-0302 "A Micro-Lender: Transactions arrive through different channels" · Very hard · 4 members, virtual**

Live prototype (private until shared): https://claude.ai/artifact/GG8Cuase3B2zU787mcn2pW

Borrowers repay through JazzCash, Easypaisa, Raast bank transfers and cash agents. The payments rarely line up with the installment they were meant for, or with the deposit that finally reaches the lender's bank. Hisaab matches every payment to an installment and to a bank deposit. It explains every adjustment and keeps confirmed money apart from projections. A live set of checks shows the books still balance.

## What the challenge asks

- Build an end-to-end solution for **applicants with thin or non-traditional credit histories**, not just a dashboard.
- Reconcile records, identify unmatched items and **explain every adjustment**.
- **Separate actual balances from forecasts**, and never present estimates as guarantees.
- **Success criteria:** use synthetic or sandbox transactions to prove ledger consistency, traceability and correct handling of exceptional payment states.

## Who it's for

| User | Who, concretely | What they need |
|---|---|---|
| **Borrower** (primary) | Rickshaw and bike riders, home tailors, kiryana shop owners, students who freelance. No credit file. Pay from a wallet, at a cash agent, by Raast, sometimes from a relative's phone. | Did my payment reach? What do I still owe? Why did my balance change? Proof that I pay on time. Urdu or English, plain words, works on a cheap phone. |
| **Lender operations** | Finance officer who checks every channel against the bank each morning. | What matched by itself, what didn't and why, one-click fixes with an audit trail, and fees and shortfalls per channel. |
| **Judges** | Will test the success criteria. | Visible proof of consistency, traceability and exceptional-state handling. |

## Three records that must agree

1. **Installment schedule:** what the borrower owes.
2. **Channel record:** what JazzCash, Easypaisa, Raast or the agent says was paid.
3. **Bank statement:** what actually landed, usually one batch per channel per day, net of fees.

Matching:
- Installment ↔ channel record: by loan reference, registered phone or account name.
- Channel record ↔ bank line: by settlement batch, where batch total − fee − reversals = deposit.

A payment that can't be placed safely is **held in suspense** with a typed reason and sent to the review queue. It is never guessed.

## One payment, end to end (Ali, rickshaw driver)

1. **2 Nov 19:40:** Rs 3,000 by Easypaisa. Matched by registered phone to installment #10, leaving Rs 2,000 due.
   `Dr Clearing·Easypaisa 3,000 / Cr Loans receivable·Ali 3,000`
2. **3 Nov morning:** Easypaisa settles 2 Nov's batch minus its 1.2% fee, but it arrives Rs 150 short. The gap becomes a claim on Easypaisa and a review item.
   `Dr Bank + Dr Channel fees + Dr Claims 150 / Cr Clearing·Easypaisa`
3. **3 Nov 11:05:** Rs 2,050 at a cash agent, reference L01. Rs 2,000 completes #10 and Rs 50 goes to credit.
   `Dr Clearing·Cash agents 2,050 / Cr Loans receivable·Ali 2,000 / Cr Borrower credit·Ali 50`
4. **10 Nov:** the Rs 50 credit is used automatically, so his app already shows Rs 4,950 to pay.

## Requirements → where we show them

| Requirement | Where | How |
|---|---|---|
| Reconcile records | Console › Payments | Ordered rules (reference, phone, account name) + settlement batches matched to bank lines |
| Identify unmatched items | Console › Review queue | Typed exceptions: unknown sender, wrong reference, paid twice, reversal, deposit with no record, missing or short settlement, borrower report |
| Explain every adjustment | Borrower "Why did my balance change?" · Console › Journal | Every entry has a reason code + a sentence generated from its own numbers (EN/Urdu) |
| Actual vs forecast | Borrower home · Console projection panel | Separate function, drawn dashed and hatched, never added to actuals, never posted |
| Ledger consistency | Proof | Double-entry, integer paisa, append-only, live checks |
| Traceability | Console › Payments › open a row | Raw payload → canonical payment → journal entries → bank line |
| Exceptional states | Proof › state diagram | Failed, pending, reversed, duplicate, partial, overpaid, held, refund due |
| End to end for applicants | Borrower app | Report a missing payment from the phone; repayment record as credit evidence |

## Architecture

```
Synthetic generator (seeded)
  → Channel adapters (Easypaisa webhook, JazzCash webhook, Agent CSV, Raast feed, Bank statement)
  → Raw event store (immutable, as received)
  → Normalizer + idempotency gate (channel + ID)
  → Matcher (rules + batch totals) ──no safe match──▶ Review queue ──ops decision + reason──┐
  → Ledger (double-entry, append-only) ◀───────────────────────────────────────────────────┘
  → Views (borrower app · ops console · proof), read-only
```

Only the matcher and recorded ops decisions write to the ledger, and every write must balance. Re-sending any file goes through the same dedupe gate and changes nothing.

## Recommended stack

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js (App Router) + TypeScript** | UI and API in one repo and one language; no API contract to negotiate |
| Database | **Supabase Postgres** | Real transactions make each journal entry all-or-nothing; table viewer for debugging |
| ORM | **Drizzle** | Typed schema + migrations; `bigint` columns for paisa |
| Validation | **Zod** | Parse every channel payload before it reaches the ledger |
| UI | **Tailwind + shadcn/ui, TanStack Table, Recharts** | Tables and one chart are the core screens |
| Test data | **@faker-js/faker**, fixed seed | Same seed, same scenario: tests and demo agree |
| Tests | **Vitest + fast-check** | Property tests: random payments in, ledger must still balance |
| Deploy | **Vercel** | Push to deploy, preview link per branch |
| Optional | Claude API (`claude-haiku-5-5`) | Rephrase explanations in Urdu; numbers always from the ledger |
| Skip tonight | Login (role switch instead), live payment APIs, late fees | If most of the team writes Python: FastAPI + SQLAlchemy for the API, keep the rest |

## Ledger rules

Money is stored as whole paisa. Entries are never edited, only reversed. Every entry has a reason code, a generated explanation, source IDs and an actor.

| Event | Debit | Credit |
|---|---|---|
| Loan starts | Loans receivable (total) | Loan capital (principal), Service charge income |
| Payment matched | Clearing · channel | Loans receivable, Borrower credit (extra) |
| Payment can't be matched | Clearing · channel | Suspense |
| Ops applies a held payment | Suspense | Loans receivable, Borrower credit |
| Channel settles a batch | Bank (net), Channel fees, Claims (shortfall) | Clearing · channel |
| Channel reverses a payment | Loans receivable | Clearing · channel |
| Duplicate marked for refund | Suspense | Refunds payable |
| Credit used on a due date | Borrower credit | Loans receivable |

## Data model

| Table | Key columns |
|---|---|
| `borrowers` | id, name, phone, work, city, preferred_channel |
| `loans` / `installments` | loan_id, borrower_id, principal_paisa, fee_paisa / installment_no, due_date, amount_paisa, paid_paisa, fully_paid_on |
| `raw_events` | id, source, received_at, payload jsonb, idempotency_key unique |
| `payments` | channel_txn_id, channel, amount_paisa, payer_phone, payer_name, reference, state, borrower_id, match_rule, batch_id |
| `bank_lines` / `settlement_batches` | line_id, value_date, amount_paisa, narration, ref / batch_id, channel, gross, fee, clawback, received, diff |
| `exceptions` | id, kind, ref, amount_paisa, suggestion, status, resolution, resolved_by |
| `journal_entries` / `journal_lines` | entry_id, reason_code, params jsonb, source_ids, actor, reverses / account, borrower_id, debit_paisa, credit_paisa |

## Who builds what

| Person | Owns | Prototype code to port |
|---|---|---|
| **P1 · Ledger** | Schema, `post()` that refuses unbalanced entries, payment state machine, invariant tests | `makeLedger`, `onReversal`, `runChecks` |
| **P2 · Data** | Seeded generator with planted anomalies, 4 channel adapters + bank statement, idempotency gate | `generate`, `ADAPT`, `onRaw` |
| **P3 · Matching** | Matching rules + batch settlement, exceptions with suggestions, ops actions that post explained entries | `identify`, `settleBatch`, `applyAction` |
| **P4 · Frontend** | Borrower app (EN/Urdu), ops console, proof page, demo + deploy | the prototype page itself |

## Tonight's timeline

1. **0:00–0:30:** repo, Supabase project, schema and shared types agreed. Everyone uses seed 2026.
2. **0:30–3:30:** build in parallel (P1–P4, P4 on mock data).
3. **3:30–5:00:** wire end to end on seed 2026; fix the first mismatches.
4. **5:00–6:30:** proof page, property tests, borrower polish, Urdu strings.
5. **6:30–7:30:** deploy to Vercel, rehearse the demo twice, submit.

**Cut-lines if behind, in this order:** name-similarity suggestions → scenario controls → Urdu rephrasing via Claude → repayment record screen. Never cut the review queue or the proof checks; they are the success criteria.

## 3-minute demo

1. **Borrower app as Shazia:** her 6 Nov installment shows as not received (she paid from her sister's phone). She enters the transaction ID from her SMS.
2. **Lender console:** her report is already linked to the unmatched JazzCash payment. One click applies it, and the entry is explained.
3. **Back to Shazia, in Urdu:** payment confirmed with a one-line reason. Her on-time record counts the day she paid.
4. **Console:** Ali's split payment, the Easypaisa batch that arrived Rs 150 short, and the projection panel kept apart from actuals.
5. **Proof:** all checks pass. Replay every file and nothing changes; try an unbalanced entry and it is rejected.
