# Real-Person Characters v2 — Account-Level Enrollment + Project-Scoped Grants

Status: DRAFT v2.1 (adversarial-review incorporated; 2 decisions await user) · 2026-07-02
Supersedes: the v1 "personal-workspace-only" real_person rule in
`character-library-real-person-portraits-design-v1.md` (§0 ⟦R5⟧).
Review: a 4-lens adversarial review (consent-legal / authz-abuse / repo-reality /
flow-ops) found 3 blocker-CLASSES + majors in v2.0; all are incorporated below
and marked ⟦V⟧. §11 is the review log. Two decisions (§1 D-A, D-B) genuinely
need the user and are NOT yet resolved.

Driver: v1's "usable only in the subject's personal workspace" makes the feature
useless for collaborative creation — Joe **and** Liz both appearing as real
AI actors in one shared Project A. The restriction is OURS (single pooled
ModelArk account; every LivenessFace group already lives there and is
technically usable by any generation) — the whole boundary is our
authz/consent layer, so we can change it. But "just relax the rule" is unsafe:
the review shows the consent anchor, the enforcement seams, and the data model
all have to change together.

## 0. The corrected mental model (user, 2026-07-02)

1. **Enrollment = account-level, one-time, workspace/project-agnostic.**
2. **Authorization = a separate act** granting a specific PROJECT permission to
   use the likeness, carrying a consent event scoped to that project.
3. **Project is the only grant scope in v1** — no workspace/global grants.

## 1. Decisions

### Resolved (best-judgment defaults — confirm)

| #   | Decision                    | v1 choice                                                                                                         |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| D1  | Enrollment identity         | Account required — actor logs in and enrolls under their own account                                              |
| D3  | Actor↔project link to grant | Actor must be an explicit **ProjectMember** (editor+) of the target project                                       |
| D5  | Revocation                  | Per-project revoke + global delete; PLUS auto-revoke on membership-loss / project-delete / ownership-transfer ⟦V⟧ |

### ⟦V⟧ UNRESOLVED — these two change the build; user must decide

**D-A — Who is consented to generate the face? → RESOLVED: A3 (grant to the
PROJECT as a mutable unit).** (User 2026-07-02: "you authorize a company, the
company can still hire new people without asking you again.") The grant is to
the PROJECT, never to enumerated individuals; editors added later are in-scope
by design, no re-consent. Safety comes NOT from headcount approval but from
the "contract terms" — the same way real-world likeness licensing works:

1. **Purpose limitation / prohibited-use** in the grant consent (only the
   named project's stated creative purpose; no sexual / defamatory /
   unlawful / political-impersonation content).
2. **Revocable anytime** — one-tap per-project revoke by the subject.
3. **Output visibility** — the subject can see every output generated from
   their likeness in the granted project.
   This is the HeyGen/Synthesia enterprise-avatar model. ⟦R6⟧ is reconciled
   EXPLICITLY: for real_person, consent is to the project as a mutable
   collaboration unit; the consent copy MUST state unambiguously that "the
   project and its members — current and future — may generate your likeness
   for the stated purpose," and that this is revocable. `authorizedUserIds`
   snapshotting (§2) is therefore DROPPED; the grant carries projectId + the
   purpose-scoped consent, and the gate checks "active grant for
   (characterId, job.projectId) + caller is an explicit active ProjectMember
   editor+ of that project" (no per-user allowlist).

**D-B — External contracted actors → RESOLVED: B2 (director-initiated casting
invite).** (User 2026-07-02: like a company contracting an actor — the company
sends the invite, you don't first make the actor an employee.) The
director-initiated invite is promoted from fast-follow into v1 core:

- ⟦V⟧ **NEW `CharacterCastingInvite`** — a director (project editor+) invites a
  person to LEND their likeness to a project. This is DISTINCT from a
  ProjectMember invite: the actor never becomes a project collaborator and
  never sees project content.
  ```
  model CharacterCastingInvite {
    id             String @id @default(uuid(7))
    projectId      String                    // FK PlatformProject, onDelete: Restrict (audited teardown)
    invitedByUserId String @db.VarChar(64)   // the director; must be ProjectMember editor+
    inviteeUserId  String? @db.VarChar(64)   // resolved recipient (if a known user)
    inviteeContact String? @db.VarChar(256)  // email/handle for an off-platform actor
    tokenHash      String                    // single-use accept token (like ProjectInvite)
    status         pending | accepted | declined | expired | revoked
    expiresAt      DateTime
    createdAt / respondedAt
  }
  ```
- **Casting flow**:
  1. Director (ProjectMember editor+ of Project A) creates a CastingInvite for
     an actor (by handle/email). Consent-sensitive copy in the invite names
     the project + purpose.
  2. Actor accepts (logs in — D1 account-required stands; a lightweight account
     is fine and is what carries the actor's later revoke/output-visibility
     rights). If the actor has no real_person character yet, acceptance leads
     into enrollment (liveness + re-versioned account consent, §3).
  3. Acceptance then shows the **per-project grant consent** (§6, purpose-scoped)
     → on accept, creates the ACTIVE `CharacterProjectGrant` linking the
     actor's character to Project A.
  4. The actor is NOT a ProjectMember; they hold a grant + the revoke/
     visibility surface only.
- ⟦V⟧ This SUPERSEDES v2.0 D3 for the external path: the accepted casting
  invite (not ProjectMember-ship) is the precondition that authorizes the actor
  to grant. A collaborating teammate who IS already a ProjectMember can still
  self-grant directly (the B1 path remains available); B2 adds the invite entry
  for actors with no prior project relationship.
- Who GENERATES is unchanged: Project A's editors (ProjectMember editor+) —
  §4 gate (b). The actor lends the face; the editors make the videos.
- Invite lifecycle: single-use token, expiry, director-revocable while pending;
  project delete/archive cancels pending invites (§7 teardown).

## 2. Data model (Prisma, apps/server) ⟦V⟧

Building ON the v1 tables already implemented this session.

- **StudioCharacter (real_person)** — shape unchanged. `subjectUserId` = the
  account; `workspaceId` = personal workspace, kept ONLY as the
  account-ownership encoding. The v1 "usable only in this workspace" rule is
  dropped — usage is governed by grants (§4).
- **NEW `CharacterProjectGrant`**:
  ```
  model CharacterProjectGrant {
    id              String   @id @default(uuid(7))
    characterId     String                       // FK StudioCharacter (Restrict — see below)
    projectId       String                       // FK PlatformProject, onDelete: Restrict ⟦V⟧
    grantedByUserId String   @db.VarChar(64)      // MUST equal subjectUserId
    status          active | revoked
    /// ⟦V⟧ FK to the scoped consent_granted record that authorized THIS grant.
    consentRecordId String
    createdAt / revokedAt
  }
  ```

  - ⟦V⟧ **Partial-active unique**, hand-written SQL:
    `(character_id, project_id) WHERE status = 'active'` — a re-grant after a
    per-project revoke is a NEW row with its OWN consentRecordId; revoked rows
    accumulate as history (matches WorkspaceMember/StudioCharacter convention).
  - ⟦V⟧ **`projectId` onDelete: Restrict**, and project delete/archive is wired
    to an AUDITED teardown (§7) — never a silent Cascade that drops consent
    state with no ledger entry.
- **CharacterConsentRecord** — gains ⟦V⟧ `scopeProjectId` **as a bare
  denormalized String with NO foreign key** (same posture as
  MediaAsset.createdByUserId / Workspace.ownerUserId). The append-only,
  Restrict-on-character ledger is legal evidence and must be immune to project
  lifecycle — a real FK would force Cascade (destroys evidence on project
  delete) or Restrict (makes projects undeletable). Grant→consent uses a
  normal FK; the ledger's project reference does not.
- ⟦V⟧ **`AiJob` queryability by project** — per-project revoke must actively
  cancel in-flight Project-A jobs referencing the character. `AiJob.projectId`
  exists; add the index / lookup to find non-terminal jobs whose
  `referenceSnapshot` includes the characterId, plus a job-level `revoked`
  flag the worker checks (the passive worker re-check alone cannot see a
  per-project revoke — see §4).

## 3. Enrollment (account-level) — changes from v1 ⟦V⟧

- Drop `requirePersonalWorkspace` as a USAGE gate; keep personal workspace as
  the home (ownership encoding).
- ⟦V⟧ **Re-version the enrollment consent.** The shipped v1 copy
  (`realperson-consent-v1-2026-07-02`, clause 4) literally promises "never
  shared with teams or other users" and that exact text is sha256-anchored in
  the ledger as the PIPL 单独同意 proof. v2 sharing contradicts it — the
  anchored evidence would become an affirmative misrepresentation. New
  `REAL_PERSON_CONSENT_VERSION` + new canonical text/hash that drops "never
  shared" and discloses "you MAY later grant specific projects, each under its
  own separate consent." Existing enrolled users must re-accept before any
  grant. (real_person isn't live yet → zero migration cost today.)
- ⟦V⟧ Add a **residency signal** (not deployment region) to the gate: the v1
  `.cn` block keys on `SITE_REGION`, never the subject's residency. A
  mainland-resident who enrolled on `.com` must not be exportable to offshore
  third-party processing until the onshore path exists.

## 4. Authorization — the load-bearing change ⟦V⟧

The generation path runs **TWO** gates per referenced character; v2.0 only
touched the first. Both must become grant-aware, and both must read the GRANT
(not group/character status) for path (b):

**Gate 1 — `requireUsableCharacter`** (server truth, readiness):

```
real_person usable in a job when EITHER
  (a) caller === subjectUserId                              // self-use
  OR
  (b) an ACTIVE CharacterProjectGrant(characterId, job.projectId) exists
      AND caller has an explicit active ProjectMember(job.projectId, editor+)
          row — NO workspace-role fallback ⟦V⟧ (D-A=A3: grant is to the
          project; any current editor is in-scope, bounded by purpose not
          headcount)
```

⟦V⟧ "editor of the project" MUST be an explicit `ProjectMember` editor+ row,
NOT `requireProjectRole` (which passes any host-workspace editor via fallback,
silently widening consent to the whole workspace).

**Gate 2 — `requireCharacterAccess`** ⟦V⟧ (membership-grade; v2.0 forgot it):
today authorizes only WorkspaceMember(job.workspace) OR CharacterProjectCast.
A granted real_person is neither (its home is the subject's personal
workspace; it can't be cast cross-workspace). Add an explicit branch: **an
active grant for (characterId, job.projectId) with caller ∈ authorizedUserIds
is itself a sufficient access path** — independent of workspace membership /
cast rows. Grant is the real_person visibility carrier; cast never authorizes
a real_person independent of grant status.

**Readiness pre-check** (`requireActiveMirrorUrl`) and **worker seam**
(`byteplus-reference-preparer`) ⟦V⟧: today they key on
`AiProviderAssetGroup.status=active` / `character.status=active`. A per-project
revoke MUST leave those active (other grants + self-use need them), so those
seams are BLIND to it. Fix:

- ⟦V⟧ Thread `job.projectId` into `ProviderGenerationContext` (worker.runJob →
  adapter.prepareReferences); today ctx = {jobId, userId, publicBaseUrl}.
- ⟦V⟧ BOTH the submit readiness check AND the worker preparer load the ACTIVE
  `CharacterProjectGrant(characterId, job.projectId)` on every attempt and
  hard-fail `CHARACTER_REVOKED` when absent/revoked — exactly as v1 keys on
  character.status, but grant-keyed for path (b).
- ⟦V⟧ Replace the preparer's `subjectUserId === jobUserId` backstop with
  "subject self-use OR active grant covering (job.projectId, caller)" — the
  current identity check rejects EVERY granted teammate.

## 5. Grant flow ⟦V⟧

Routes (subject-only unless noted):

- `POST /aurora/characters/:id/grants { projectId, authorizedUserIds? }` —
  asserts caller === subject, character real_person + active, **project active
  & not-deleted** ⟦V⟧, caller ∈ ProjectMember(projectId) editor+. Shows the
  per-project grant consent screen (§6), appends the scoped `consent_granted`
  record, creates the active grant snapshotting `authorizedUserIds` (per D-A).
- `DELETE /aurora/characters/:id/grants/:projectId` — ⟦V⟧ reachable from the
  character-detail surface (NOT project-gated), so a subject removed from the
  project can still withdraw. Flips grant→revoked, appends scoped `revocation`,
  and **actively cancels in-flight Project-A jobs** referencing the character
  (new machinery, §2 AiJob-by-project + job revoked flag) + releases holds.
  Does NOT touch the LivenessFace group or character.status (other grants live).
- `GET /aurora/characters/:id/grants` — subject sees their grants; a project
  editor sees real_person characters granted to their project.
- ⟦V⟧ **Cast picker data path**: a granted real_person has no cast row and
  can't get one. The team-project picker returns cast entries UNION active
  grants for the project (DTO must NOT leak the foreign home workspace).

⟦V⟧ **Auto-revoke triggers** (not just subject-initiated):

- Subject's `ProjectMember` row removed/deactivated → grant auto-revoked
  (or suspended + notify); membership re-validated at generation time too.
- Project ownership / workspace transfer → grants invalidated.
- Project archive / soft-delete / hard-delete → per-project teardown per grant
  (scoped revocation ledger + job cancel), grant→revoked.
- ⟦V⟧ **Global character delete/revoke** (`enrollment.revoke()`) must fan out
  over ALL active grants → revoked + scoped revocation per grant + cancel
  in-flight jobs across every granted project. Today revoke() is grant-blind.

## 6. Consent & compliance (HIGHER bar — third parties generate the face) ⟦V⟧

- **Per-project grant consent copy** (new version) names: the project, the
  EXACT authorized population (per D-A), the offshore processor + purpose
  (⟦V⟧ its own Art.38-39 cross-border separate consent, not resting on the
  self-use enrollment consent), retention, withdrawal, adult attestation, and
  ⟦V⟧ **purpose limitation + prohibited-use** (no sexual / defamatory /
  unlawful / political-impersonation content; use confined to the named
  project's stated creative purpose).
- ⟦V⟧ **Subject visibility over outputs**: the subject gets a surface listing
  every output generated from their likeness in a granted project (via
  job.projectId + expandedReferences + MediaAssetUsage) — not only a reactive
  report channel.
- ⟦V⟧ **Existing outputs on revoke**: the grant consent states explicitly what
  happens to already-generated videos; per-project revoke gives the subject a
  takedown/unpublish path over ALL outputs derived from their likeness in that
  project (host notified), and we decide+document whether revocation freezes
  further publication/monetization of existing face-videos.
- **Report + 48h NCII takedown** = HARD launch gate for v2 (third-party face
  generation makes it non-negotiable), wired to per-project (not just global).
- ⟦V⟧ **Retention**: when the LAST active grant is revoked, surface "you have
  no active authorizations — delete to purge your biometric data" and consider
  starting the shred clock then, not only on global delete (PIPL minimization).

## 7. Out of scope for v2 (explicit)

- No-account contracted-actor invite link (unless D-B=B2 pulls it in).
- Workspace-level or org-level grants (project scope only).
- Cross-ModelArk-account authorization (single pooled account).

## 8. Migration & rollout

- Hand-written migration: `CharacterProjectGrant` (partial-active unique) +
  `scopeProjectId` (no-FK String) on `CharacterConsentRecord` + `AiJob`
  project/character lookup index.
- Behind `CHARACTERS_REAL_PERSON_ENABLED`.
- No change to the AIGC (virtual) path built this session.

## 11. Review log (v2.0 → v2.1)

4-lens adversarial review, 2026-07-02, 28 findings. Blocker-classes:

1. **Enforcement**: per-project revoke was invisible to both enforcement seams
   (they key on group/character status, which a partial revoke can't touch);
   worker ctx has no projectId. → grant is the source-of-truth, projectId
   threaded, both seams + both authz gates grant-keyed, active job-cancel added.
2. **Consent anchor**: enrollment consent promised "never shared" (must
   re-version); grant to "any editor" is open-ended/owner-controlled (D-A);
   no purpose-limitation; cross-border + residency gaps.
3. **Data model**: scopeProjectId as an FK destroys evidence or blocks project
   delete (→ bare String); full unique blocks re-grant (→ partial-active);
   global delete + project delete + membership-loss not reconciled with grants.
   Plus: requireCharacterAccess (2nd gate) was grant-blind; cast picker can't
   surface a granted character; existing outputs survive revoke with no takedown.
   Two decisions (D-A authorized population, D-B external-actor scope) are the
   user's and remain open.
