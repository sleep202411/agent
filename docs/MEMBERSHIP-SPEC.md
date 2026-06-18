# Membership · Creator Pool · Referral — Spec

> Status: **Draft** · 2026-06-15 · Owner: platform
> Scope: subscription membership for free 剧集 viewing, a creator watch-time
> revenue pool, and a referral (share-and-both-benefit) loop.
> Home: **NestJS `apps/server` + Postgres** (Java = auth API only). Consumer UI:
> **`apps/web`**. Studio surfaces (AI credits) where noted.

## Context

The platform already monetizes content à-la-carte: a community-point wallet
funds per-IP/per-episode purchases (`IpPriceRule` → `IpPurchaseOrder` →
`IpContentEntitlement` → media gate), and creators are paid per sale via a
per-contributor split into a **withdrawable** wallet. The schema also already
carries a subscription/membership billing foundation (`BillingMembershipPlan`,
`BillingSubscription` + `BillingSubscriptionCycle`, `BillingPrice`,
`EntitlementGrant`) and `IpContentEntitlement.sourceType` already allows
`membership`. This spec adds three layers on top of those primitives — it does
not rewrite them. Java's `recommendationCode` invite feature is **not** reused
(thin, no reward, relationship trapped in Java); referral is built fresh in Nest.

## 0. Foundational principles (apply to all three pillars)

- **Ledger-correct money.** No balance is mutated directly. Every value move is
  an append-only `WalletLedgerEntry` (debit/credit, reason, source, running
  balance). Reversals are **compensating entries**, never deletes.
- **Exactly-once.** Every grant/charge/payout carries an **idempotency key**;
  replays are no-ops. No double-reward, no double-charge.
- **Thin critical path.** Checkout and playback never block on reward/pool work.
  Those run **async, idempotent, retryable, DLQ-backed** (reuse the existing
  worker/DLQ pattern — `MediaTakedownWorker` / `CdnPurgeWorker`). A failed pool
  job never degrades streaming or checkout → 99.99% availability target.
- **Auditable & reconcilable.** Every payout traces to its source event; pool
  and referral outflows reconcile against subscription revenue each period.
- **Anti-fraud is a first-class requirement**, designed in (not bolted on).
- **Ownership.** Nest/PG owns membership, wallet, pool, referral end-to-end.
  Java only authenticates. UI copy is English-first via i18n (`messages/*`);
  honest stubs until a backend exists; no faked UI.
- **Money unit.** `community_point ≡ US$0.01`. Withdrawable points are creator
  cash; consumable points are spend credit. Fiat normalizes to points at 1pt=1¢.

---

## 1. Membership (Tencent-style hybrid)

A VIP subscription layered **on top of** à-la-carte — not a replacement.

### 1.1 Tiers

|                                     | Plus                   | Pro                              |
| ----------------------------------- | ---------------------- | -------------------------------- |
| Plan (`BillingMembershipPlan.rank`) | 1                      | 2                                |
| Price (`BillingPrice`)              | $9.99/mo · intro $5.99 | $19.99/mo · intro $11.99 _(TBD)_ |
| Annual                              | 2 months free          | 2 months free                    |
| Pool 剧集 library                   | full, free             | full, free                       |
| Quality / streams                   | 1080p · 2 streams      | 4K HDR · 4 streams + downloads   |
| Early access                        | standard               | earliest                         |
| AI generation credits               | entry                  | larger + advanced models         |
| Exclusives                          | —                      | optional Pro-only titles         |

Intro price is a **dated promo `BillingPrice`** or a **founding-member locked
price** (§6.5).

### 1.2 Content modes (creator-set, per IP)

`Ip.membershipInPool` (opt-in) and à-la-carte `IpPriceRule` are independent:

- **Pool + à-la-carte** — members free, non-members buy (the VIP norm).
- **Pool only** — members free, non-members must subscribe.
- **À-la-carte only** — not in the pool; everyone buys (today's model, untouched).

### 1.3 Access logic

`getIpAccess()` and `MediaAccessService.requireAccess()` grant when
**(active `BillingSubscription` whose tier includes the content) AND
(`ip.membershipInPool`)** — a **dynamic check**, no per-member entitlement-row
explosion. `IpContentEntitlement[sourceType=membership]` is reserved for
explicit/edge grants. `MediaAsset.visibility` stays the source of truth:
membership only unlocks `public` episodes; `private`/`workspace` never overridden.

### 1.4 Functional requirements

- **M1** Subscribe / upgrade / downgrade / cancel via Airwallex recurring.
- **M2** Proration on tier change.
- **M3** Access is gated on `BillingSubscription.status`; `past_due`/grace states
  defined; access auto-extends to `currentPeriodEnd` on renewal, revokes on lapse.
- **M4** Dunning + retry on failed charge; webhook-driven status transitions.
- **M5** Region/currency aware (intl fiat via Airwallex; CN per its rail).

---

## 2. Creator revenue pool

### 2.1 Source

`pool(period, region) = Σ net subscription revenue × poolShareBps`. Only
subscription money funds the pool. À-la-carte sales keep paying creators per-sale,
unchanged.

### 2.2 Metering

`MembershipWatchLedger` fed by a **playback heartbeat** (~30s cadence), counting
**only active-member watch-time of pool episodes**, **capped** (≤ `duration ×
replayFactor`, min-watch threshold, cadence-validated). Free-preview and
non-member views never draw the pool.

### 2.3 Distribution (monthly, idempotent job)

1. Lock the period (no further accrual).
2. `ipEarning = pool × ip_eligibleSeconds / total_eligibleSeconds` (watch-time
   pro-rata).
3. Split `ipEarning` by the existing per-contributor revenue share.
4. **Credit withdrawable points** via `WalletLedgerEntry` (same rail as per-sale
   creator revenue).
5. Audit: `MembershipPoolPeriod`, `MembershipPoolPayout`. Re-runnable safely
   (idempotency per period+ip+contributor).

### 2.4 Integrity

Period payout totals reconcile to `revenue × poolShareBps`; refunded cycles are
excluded/netted. Watch-time anti-gaming (§4) directly governs payouts.

---

## 3. Referral (Nest-owned; share → both benefit)

### 3.1 Identity & link

`ReferralCode` — one stable short code per user. Share link `/membership?ref=<code>`
(+ QR). Surfaced in a new "Invite friends" page/modal (replaces the Java
recommendation-code dialog).

### 3.2 Attribution

Click stores `ref` (cookie, 30-day window). After Java-auth registration, the web
binds **referrer → referee** via a Nest endpoint → `Referral(status=pending)` in
PG. Self-referral and already-registered binds are rejected. Last-touch within
window.

### 3.3 Qualify & reward (dual benefit)

On the referee's **first paid membership** (`BillingSubscriptionCycle` fulfilled):
`Referral → qualified`, then grant:

- **Referrer**: membership days _or_ points (§6.1), idempotent (ledger entry /
  subscription extension).
- **Referee**: signup perk (deeper intro / bonus days, §6.2), applied at checkout.

### 3.4 Clawback

Referee refund/chargeback inside the window → `Referral → voided` + a
**compensating reversal** of the referrer reward (never delete). Stricter variant:
hold the referrer reward `pending` until the refund window passes, then release.

---

## 4. Anti-fraud (mandatory, cross-cutting)

- Reward only on **paid + first-membership + window-cleared** — never on signup.
- **Self / circular referral** blocked; multi-account heuristics (payment
  instrument, device, IP, fingerprint).
- **Velocity caps** (rewarded referrals per referrer/period) + diminishing
  returns; anomalies → **hold → manual-review queue**.
- **Watch-time gaming** defenses (per-episode caps, completion thresholds, bot
  detection) gate pool accrual.
- All money outflows reversible via compensating entries; clawback is first-class.

## 5. Reliability, scale, observability

- Reward, pool distribution, and heartbeat ingestion are **async, idempotent,
  retry + DLQ**; checkout/playback never await them.
- Heartbeat ingestion sized for high write volume (batch/aggregate, partition by
  period).
- **Observability**: per-event audit trail, reconciliation reports, dashboards
  (referral funnel, pool distribution, fraud holds), alerting on reconciliation
  drift.
- **Admin**: configure plans/prices/intro, pool share, referral rewards/caps;
  review fraud holds; manual grant/clawback (audited).

## 6. Open product decisions

1. **Referrer reward currency** — membership **days** (cheap, retention+) vs
   **points** (consumable vs **withdrawable = cash**).
2. **Referee perk** — extra intro discount vs bonus free days.
3. **Referral type** — one-time per referee vs ongoing affiliate commission.
4. **Reward sizing** (give-a-month / get-a-month?) + refund/hold window length.
5. **Intro pricing** — dated promo vs founding-member lock-in.
6. **Pool currency** — one normalized global pool vs separate CN/intl pools.
7. **Pro price** confirmation; AI-credits-in-Pro vs video-only tiers.

## 7. Data model summary

**New** (Nest/PG): `Ip.membershipInPool`; `MembershipWatchLedger`,
`MembershipPoolPeriod`, `MembershipPoolPayout`; `ReferralCode`, `Referral`,
`ReferralReward`.
**Reused**: `BillingMembershipPlan` / `BillingSubscription` /
`BillingSubscriptionCycle` / `BillingPrice` / `EntitlementGrant`;
`WalletAccount` / `WalletLedgerEntry` (append-only); per-contributor split;
`IpContentEntitlement[sourceType=membership]`; `Ip` / `IpEpisode` / `IpPriceRule`
/ `MediaAsset`.
