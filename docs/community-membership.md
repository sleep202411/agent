# Community Membership (社区会员) — Design & Build Plan

Net-new product on `.com` (the cross-stack audit confirmed it did not exist; only VIP
`membership_plan` + `team_membership_plan` + the two point wallets existed). Built on
**Nest `/aurora` billing** (target-state, parallel to the legacy Java VIP individual flow,
consistent with team membership). Honors `AGENTS.md` Engineering standards.

## Product model

- **Experience = Netflix** (subscription → unlimited member-free viewing). **Creator payout =
  YouTube Premium / Spotify** (monthly subscription-revenue POOL distributed by member-view
  share). Netflix-style licensing is a FUTURE additive payout source, not built now.
- **Price:** 9.99 base, **monthly + yearly + auto-renew**; admin-configurable discount via the
  existing `BillingPromotion` (no bespoke discount field).
- **Benefits:** (1) member discount on points-priced IPs; (2) per-IP **member-free viewing**
  (creator chooses `points_priced` | `member_free`); (3) exclusive content / member badge.
  **No free community points** — `community_point` is creator-withdrawable money; must not dilute.
- **Creator revenue for member-free views** = monthly pool → split by member-view share →
  existing withdrawable `community_point` wallet.

## Core principles (bake in now)

1. **Viewing-access ⊥ creator-compensation** — two independent ledgers: `IpContentEntitlement`
   (access) vs `IpRevenueLedgerEntry` + `MemberViewEvent` (compensation).
2. **Source-typed earnings** — `IpRevenueLedgerEntry.sourceType ∈ {ip_sale, member_pool,
licensing}`. Licensing/Netflix later = add one enum value + a service reusing the same
   generalized credit path. Zero refactor.
3. **Member access expires with membership; already-distributed pool earnings never claw back.**
4. Gate IP features on `planKey === 'community_membership'`, NOT on rank (avoid VIP/studio
   rank cross-contamination).

## Data model (Prisma)

- enum `IpAccessMode { points_priced, member_free }`; `Ip.accessMode` (default points_priced) +
  `Ip.memberFreeBps Int?` (NULL inherits global `ip.member_free_bps`).
- `IpPriceRule.memberDiscountBps Int?` (NULL inherits global `ip.member_discount_bps`; 0 disables).
- `IpContentEntitlement` — NO schema change; member-free uses `sourceType='member_free_grant'`,
  deterministic `sourceId='member:{userId}:{ipId|episodeId}'`, `endsAt`=membership period end.
- enum `IpRevenueSourceType { ip_sale, member_pool, licensing }`; `IpRevenueLedgerEntry.sourceType`
  (default ip_sale) + `settlementBatchId Uuid?` + `orderId` made nullable + partial-unique on
  (settlementBatchId,userId) WHERE settlement_batch_id IS NOT NULL (keep the sales unique intact).
- NEW `MemberViewEvent` — pool weight ledger; @@unique(userId,episodeId,settlementPeriod).
- NEW `MemberPoolSettlementBatch` + enum `MemberPoolBatchStatus { computing, posted, voided }`.
- `BillingProductType` += `community_membership_plan` (one-line); plan `planKey='community_membership'`.
- Settings: seed `ip.member_discount_bps`, `ip.member_free_bps`, pool floor in `IpCommerceSetting`
  (reuse the `ip.creator_revenue_share_bps` NULL-coalesce precedent).

## Server

- `EntitlementService.isActiveCommunityMember(user)` (planKey match + active; grace via
  `BillingSubscription.currentPeriodEnd`; never silently downgrade — log misses).
- `purchaseContent()`: member-free → free `member_free_grant` entitlement, zero debit, NO
  point-of-sale revenue (pool compensates). points_priced + member → discounted debit, creator
  still earns from the discounted sale via existing `ip_sale`.
- `resolvePriceRuleTx(isMember)` applies the discount post-selection (no member rule variant).
- `getIpAccess`/`getPublicIp`: `member_free` access state for members; gated CTA for non-members;
  episode paid rule overrides IP member_free (documented precedence + server guard).
- `MemberAccessService.recordMemberView` on the play/stream endpoint (idempotent monthly).
- `MemberPoolSettlementService.settlePeriod(period, poolAmountMinor)` — locked batch, aggregate
  weights, exact conservation + remainder rule, idempotent (`member_pool:{batchId}:{userId}`),
  fails loud on totalWeight=0 with pool>0.
- Generalize `creditWithdrawableCommunityPointTx({sourceType, sourceId, idempotencyKey, ...})` —
  single reusable atomic credit block (sale + pool + future licensing).
- Billing fulfillment reuses the generic EntitlementGrant path + existing subscription renewal.

## Web / Admin

- web: `CommunityMembershipDialog` (model on community-recharge-dialog), `useCommunityMembership`,
  IP detail member-free CTA + server-provided member price, creator-earnings "membership pool"
  line, member badge. No client-side price math. AppLovin `axonPurchase` reused.
- admin-ui (Chinese): per-IP 社区会员访问 toggle + 会员折扣/分成 bps; global settings; allow
  `community_membership_plan` in plan/promotion pickers; pool settlement console (manual-first).

## Build phases (verifiable milestones)

0. **Membership product** — plan + monthly/yearly/autorenew prices + `community_membership_plan`
   productType + `CommunityMembershipDialog` + `useCommunityMembership`. Milestone: buy + renew;
   `isActiveCommunityMember()` true.
1. **Schema + settings migration** (hand-written, minimal; no `migrate dev`). Milestone: clean
   `migrate deploy` on staging clone; existing IP-purchase tests green (sourceType defaults ip_sale).
2. **Member discount** on points-priced. Milestone: member buys at discount; creator earns from
   discounted total; non-member unaffected; vitest on math.
3. **Member-free access** (accessMode + free-grant path + web CTA). Milestone: member unlocks free,
   access expires with membership, idempotent.
4. **View signal** (`recordMemberView` on play). Milestone: one weighted event/episode/month.
5. **Pool settlement** (`settlePeriod` + console + generalized credit). Milestone: exact pool
   conservation, idempotent re-run, sourceType=member_pool, earnings line shows.
6. **Cron + observability**.

## Top risks (mitigations baked into the phases)

membership-status webhook latency (subscription grace fallback) · rank collision (gate on planKey)
· episode-vs-IP precedence (server guard) · pool conservation + idempotency · MemberViewEvent abuse
(fairness cap deferred, flagged) · orderId-nullable vs existing unique (keep sales unique intact)
· member-free revoke-on-lapse without earnings clawback · no fake UI (pool/console only after Phase 5).

Full integration map + per-file hooks: workflow run `wf_389e857b-d76` (transcript).
