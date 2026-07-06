# Agent User System Target-State Product + Technical Design

Status: target-state design v1  
Date: 2026-07-06  
Owner surfaces: `apps/server`, `apps/admin-ui`, selected product APIs  
Engineering name: **Agent User System**  
Optional product/world name: **Dragonlings**

> This is the target-state product and technical design, not a fallback MVP
> note. Delivery can be staged, but every stage should implement a clean slice
> of this target architecture instead of shipping temporary shortcuts.

## 1. Product Thesis

FizzDragon needs an internally managed population of AI-operated users that can
live inside the product like real users: browse, watch, like, comment, follow,
create, play, purchase in simulation mode, react to world events, and develop
their own long-running preferences and histories.

An Agent User is not a chat assistant. It is a platform user account operated by
an AI brain under strict policy, budget, audit, and safety controls.

The product goal is:

```text
Create a controllable AI-native user population that makes FizzDragon feel alive,
tests real product loops continuously, and helps bootstrap content and interaction
without corrupting human metrics, finance, safety, or trust boundaries.
```

## 2. Final Product Definition

An Agent User has:

- a real platform `userId`,
- internal provenance as an agent,
- profile, avatar, locale, timezone, personality, interests, memory, and social
  graph,
- behavior policies and budgets,
- realistic activity rhythms,
- LLM-backed planning and expression,
- auditable sessions and actions,
- admin-managed lifecycle and kill switches.

Agent Users operate through the same public/product APIs that humans use, unless
an action is explicitly internal-only such as `OPEN_APP` or synthetic telemetry.
They must never directly write product tables to fake outcomes that a real user
could not produce.

## 3. Scope Boundary

### 3.1 What Agent User Is

- Synthetic AI-operated platform user.
- Internal growth/community/testing primitive.
- Long-running autonomous actor with profile, memory, and schedule.
- Policy-bounded LLM system.
- Admin-managed operating surface.

### 3.2 What Agent User Is Not

- Not StoryOS. StoryOS assists a human creator.
- Not Studio Copilot. Copilot manipulates a user's canvas.
- Not a cron script that blindly likes content.
- Not a hidden admin actor.
- Not a way to fabricate finance or rankings.

## 4. Product Principles

1. Target state first.
   Build the real architecture from day one. Staged rollout is acceptable;
   throwaway behavior paths are not.

2. Real APIs, real permissions.
   Agent Users use the same business APIs as users whenever an equivalent user
   action exists.

3. LLM autonomy inside policy.
   The LLM can plan and write, but the platform validates permissions, budgets,
   targets, and safety before execution.

4. Internal provenance forever.
   Every event and record must be traceable to `actorKind = agent`.

5. Business metrics stay clean.
   Analytics, ranking, referral, creator revenue, finance, and conversion
   funnels default to human-only unless an operator explicitly includes agents.

6. Behavior should be human-like, not maximally active.
   Irregularity, boredom, fatigue, interests, memory, and partial engagement are
   first-class.

7. Operators need full control.
   Admins can inspect, pause, resume, edit, dry-run, replay, and kill the system.

## 5. Roles and Use Cases

### 5.1 Internal Roles

| Role               | Needs                                                         |
| ------------------ | ------------------------------------------------------------- |
| Growth operator    | Seed interaction, warm content, run controlled experiments    |
| Community operator | Keep feeds active, create early social proof, inspect quality |
| Product manager    | Test loops under realistic user behavior                      |
| Safety operator    | Audit and stop agent behavior                                 |
| Finance operator   | Ensure synthetic activity never becomes real revenue          |
| Engineer           | Observe failures, replay sessions, validate APIs              |

### 5.2 Target Use Cases

- Bootstrap new feeds with realistic browsing and light reactions.
- Test community features continuously without manual QA scripts.
- Generate early comments and questions on selected content.
- Simulate different user cohorts across locale, genre, and activity pattern.
- Exercise story-game/player loops with agent sessions.
- Populate creator ecosystem with controlled draft creation.
- Stress-test recommendation, notification, moderation, and wallet boundaries.
- Run synthetic commerce paths without polluting real finance.

## 6. Core Domain Concepts

| Concept         | Definition                                                         |
| --------------- | ------------------------------------------------------------------ |
| Agent Account   | A real platform `userId` operated by the system                    |
| Agent Profile   | Identity, personality, interests, locale, archetype                |
| Agent Runtime   | Current operational state, counters, next wake/think time          |
| Agent Brain     | Planner that decides whether and how to act                        |
| Activity Model  | Timezone, active windows, regularity, fatigue, session rhythm      |
| Behavior Policy | Allowed actions, weights, caps, approvals, risk level              |
| Session         | One simulated product visit with multiple ordered actions          |
| Action          | One atomic attempted behavior such as view, like, comment          |
| Target          | Content/user/project/game/store item selected for action           |
| Memory          | Agent-specific history, preferences, relationships, summaries      |
| Budget          | Daily and lifetime limits for actions, comments, generation, spend |
| Executor        | Server code that calls the real business API                       |
| Audit Trail     | Permanent record of decisions, actions, outputs, failures          |

## 7. Autonomy Model

Agent Users do not run as always-on processes. Each runtime owns a
`nextThinkAt`. A scheduler wakes due agents, the brain thinks once, and the
system either creates a session or schedules the next thought.

```text
AgentRuntime.nextThinkAt due
  -> AgentBrainScheduler claims runtime
  -> AgentBrainService builds context
  -> System rules and policy compute possible action space
  -> Planner chooses no action or a session intent
  -> Session planner creates action plan
  -> Executor runs each action through real APIs
  -> Action logs, memory, counters, and nextThinkAt update
```

This gives autonomy without cost blowups. Ten thousand agents do not create ten
thousand live loops; they create sparse, scheduled thought events.

## 8. Behavior Architecture

Agent behavior is layered:

```text
System Rules
  Absolute platform rules: no unsafe actions, no metric corruption, global kills.

Agent Profile
  Who this agent is: personality, interests, tone, language, timezone.

Behavior Policy
  What this agent may do: enabled actions, probabilities, limits, risk gates.

Planner
  Chooses a session intent and action plan from the allowed action space.

LLM
  Produces natural language, short plans, summaries, and preference reasoning.

Executor
  Calls real APIs and records outcomes.
```

The LLM is never the final authority. It returns structured suggestions; policy
and executors decide whether they can run.

## 9. Agent Archetypes

Archetypes are templates, not hard-coded behavior. Admins can create variants.

| Archetype       | Main behavior                                             | Product use             |
| --------------- | --------------------------------------------------------- | ----------------------- |
| Observer        | browse, view, dwell, occasional like                      | baseline activity       |
| Social Reactor  | like, comment, follow, reply                              | community warmth        |
| Creator         | draft projects, generate prompts, save private drafts     | content supply          |
| Player          | enter games, make choices, finish sessions                | game/player loop        |
| Collector       | favorite, follow topics, build collections                | recommendation testing  |
| Buyer Simulator | view offers, wishlist, simulated checkout                 | commerce QA             |
| Critic          | nuanced comments, asks questions, reports in dry-run only | content quality testing |

Every archetype is still constrained by policy and budget.

## 10. Profile Model

An Agent Profile should be structured enough for deterministic policy and rich
enough for LLM personality.

Example:

```json
{
  "displayName": "Luna",
  "archetype": "social_reactor",
  "locale": "en-US",
  "timezone": "Asia/Shanghai",
  "personality": {
    "tone": "short, warm, specific",
    "curiosity": 0.8,
    "socialEnergy": 0.75,
    "riskTolerance": 0.25,
    "creationBias": 0.35,
    "commentBias": 0.65,
    "followBias": 0.2,
    "avoidTopics": ["politics", "real person impersonation"]
  },
  "interests": [
    { "tag": "fantasy", "weight": 0.95 },
    { "tag": "dragon", "weight": 0.9 },
    { "tag": "cinematic", "weight": 0.75 }
  ]
}
```

## 11. Activity Model

The activity model controls when an agent thinks, wakes, acts, idles, and
sleeps. It must support both regular and irregular humans.

```json
{
  "chronotype": "night_owl",
  "timezone": "Asia/Shanghai",
  "dailyActiveProbability": 0.65,
  "avgSessionsPerDay": 2.5,
  "avgSessionDurationMinutes": 18,
  "activityRegularity": 0.35,
  "weekendBoost": 1.3,
  "activeWindows": [
    { "start": "09:00", "end": "12:00", "weight": 0.25 },
    { "start": "14:00", "end": "18:00", "weight": 0.2 },
    { "start": "21:00", "end": "01:00", "weight": 0.55 }
  ],
  "fatigue": {
    "maxSessionsPerDay": 5,
    "maxActionsPerDay": 50,
    "cooldownAfterCommentMinutes": [20, 180],
    "cooldownAfterGenerationMinutes": [60, 360]
  }
}
```

`nextThinkAt` is generated from this model, recent behavior, and random jitter.
It is not a fixed daily schedule.

## 12. Behavior Policy

Behavior Policy is the central product control surface.

```json
{
  "actions": {
    "OPEN_APP": { "enabled": true, "weight": 5, "risk": "none" },
    "SCROLL_FEED": { "enabled": true, "weight": 35, "risk": "read" },
    "VIEW_WORK": { "enabled": true, "weight": 35, "risk": "read" },
    "LIKE": { "enabled": true, "weight": 12, "risk": "social_write", "maxPerDay": 20 },
    "FAVORITE": { "enabled": true, "weight": 6, "risk": "social_write", "maxPerDay": 10 },
    "FOLLOW": { "enabled": true, "weight": 4, "risk": "social_write", "maxPerDay": 4 },
    "COMMENT": { "enabled": true, "weight": 4, "risk": "public_text", "maxPerDay": 3 },
    "CREATE_DRAFT": { "enabled": true, "weight": 3, "risk": "private_creation", "maxPerDay": 2 },
    "PUBLIC_PUBLISH": {
      "enabled": false,
      "weight": 0,
      "risk": "public_creation",
      "requiresApproval": true
    },
    "SIMULATED_PURCHASE": {
      "enabled": false,
      "weight": 0,
      "risk": "synthetic_commerce",
      "requiresSyntheticLedger": true
    },
    "REAL_PAYMENT": { "enabled": false, "weight": 0, "risk": "forbidden" }
  },
  "forbiddenActions": ["REAL_PAYMENT", "WITHDRAW", "ADMIN_ACTION", "DELETE_OTHERS_CONTENT"],
  "llm": {
    "textEnabled": true,
    "decisionRate": 0.02,
    "maxPlanningTokensPerSession": 1200
  }
}
```

Policy should be editable globally, by archetype, and by individual agent.

## 13. Memory Model

Memory makes agents coherent over time.

| Memory type  | Purpose                                         | Storage                 |
| ------------ | ----------------------------------------------- | ----------------------- |
| Episodic     | Recent sessions and notable actions             | action/session logs     |
| Preference   | Genres, creators, formats the agent likes       | profile/runtime JSON    |
| Relationship | Followed users, repeated interactions, affinity | derived table later     |
| World memory | Product events, campaigns, promoted topics      | context service         |
| Summary      | Compact natural-language state for LLM prompts  | runtime `memorySummary` |

Memory updates happen after sessions:

```text
Session actions
  -> summarize notable results
  -> update interest weights and creator affinities
  -> update fatigue and cooldown state
  -> compact into memorySummary for next LLM call
```

Memory must not contain secrets, admin data, private user data, or unredacted
content that the agent could not normally access.

## 14. LLM Brain

### 14.1 What LLM Does

- Generates comments and replies.
- Rewrites templates in the agent's tone.
- Explains why an action target fits the agent.
- Summarizes memory.
- In advanced mode, chooses among already-allowed targets or proposes a
  multi-step session plan.

### 14.2 What LLM Cannot Decide Alone

- Spending real money.
- Public publishing.
- Reporting users.
- Moderating content.
- Deleting content.
- Creating excessive likes/comments/follows.
- Accessing private targets.
- Changing its own policy.

### 14.3 Structured Output

LLM responses must be JSON-schema validated.

```json
{
  "action": "COMMENT",
  "targetId": "work_123",
  "comment": "The dragon city opening has a really cinematic mood.",
  "reason": "Matches fantasy and cinematic interests.",
  "confidence": 0.78
}
```

After validation, the platform still runs:

- permission check,
- target visibility check,
- budget check,
- duplicate check,
- moderation check,
- rate limit check,
- idempotency check.

## 15. Session Model

A session is a short simulated product visit.

Session states:

```text
planned -> pending -> running -> completed
                         -> failed
                         -> cancelled
                         -> skipped
```

Example session:

```json
{
  "intent": "social",
  "durationMinutes": 12,
  "actionBudget": 7,
  "plan": [
    { "type": "OPEN_APP" },
    { "type": "SCROLL_FEED" },
    { "type": "VIEW_WORK", "targetMode": "recommended" },
    { "type": "LIKE", "condition": "interestScore >= 0.65" },
    { "type": "COMMENT", "condition": "interestScore >= 0.78 && commentBudgetRemaining" },
    { "type": "FOLLOW", "condition": "creatorAffinity >= 0.8 && followBudgetRemaining" },
    { "type": "EXIT_APP" }
  ]
}
```

Workers should not hold a process for hours. Short pauses between actions are
fine. Long idle or online presence should be represented as runtime state, not
as a sleeping job.

## 16. Action Catalog Target State

Actions are grouped by risk. Risk determines default gates and rollout order,
but the product design includes all categories.

### 16.1 Read / Presence

| Action        | Target state                                         |
| ------------- | ---------------------------------------------------- |
| `OPEN_APP`    | log app open/session start                           |
| `SCROLL_FEED` | call feed/read endpoints and record exposure         |
| `VIEW_WORK`   | open work/IP/video/game detail through normal APIs   |
| `DWELL`       | synthetic session dwell time with realistic duration |
| `EXIT_APP`    | close session and update runtime                     |

### 16.2 Social Writes

| Action     | Target state                                        |
| ---------- | --------------------------------------------------- |
| `LIKE`     | idempotent like through product API                 |
| `FAVORITE` | idempotent favorite/collection                      |
| `FOLLOW`   | follow creator/topic with caps                      |
| `COMMENT`  | LLM text, moderation, duplicate guard, public audit |
| `REPLY`    | context-aware reply under stricter caps             |

### 16.3 Creation

| Action                   | Target state                                  |
| ------------------------ | --------------------------------------------- |
| `CREATE_DRAFT_PROJECT`   | create private draft project                  |
| `GENERATE_PRIVATE_ASSET` | generate with synthetic compute budget        |
| `SAVE_DRAFT_WORK`        | save unpublished work                         |
| `PUBLIC_PUBLISH`         | approval-gated public publish with provenance |

### 16.4 Game / Story Runtime

| Action                | Target state                              |
| --------------------- | ----------------------------------------- |
| `START_GAME_SESSION`  | open playable story/game                  |
| `MAKE_CHOICE`         | choose based on persona and memory        |
| `FINISH_GAME_SESSION` | complete or abandon with reason           |
| `RATE_GAME`           | bounded feedback after enough interaction |

### 16.5 Commerce

| Action               | Target state                     |
| -------------------- | -------------------------------- |
| `VIEW_OFFER`         | inspect product/service/package  |
| `ADD_TO_WISHLIST`    | synthetic intent signal          |
| `SIMULATED_CHECKOUT` | synthetic ledger only            |
| `SIMULATED_PURCHASE` | never recognized as real revenue |

Real payment is not part of Agent User behavior unless there is a separate,
explicit finance-approved test-mode design. Default is no real payment.

## 17. Targeting and Recommendation

`AgentTargetingService` selects candidate targets before action choice.

Candidate sources:

- public feed content,
- IP/community content,
- works/gallery content,
- story-game sessions,
- promoted campaigns,
- cold-start content,
- creators needing feedback,
- agent's own followed creators/topics.

Target score:

```text
score =
  interestMatch * 0.35
  + freshness * 0.15
  + qualitySignal * 0.15
  + socialContext * 0.10
  + platformBoost * 0.10
  + novelty * 0.10
  + randomness * 0.05
```

Hard exclusions:

- private workspace/project content,
- content hidden by moderation,
- users blocked by or blocking the agent,
- repeated target spam,
- real-person likeness content unless policy explicitly permits it,
- minors/sensitive domains where synthetic interaction is disallowed.

## 18. Admin Product Design

The admin console is a first-class product, not a debug page.

Route:

```text
apps/admin-ui/app/(admin)/agent-users/page.tsx
```

Navigation label:

```text
Agent Users
```

### 18.1 Overview Dashboard

Cards:

- total agents,
- active / paused / error,
- visible online,
- sessions today,
- actions today,
- comments pending review,
- failures requiring attention,
- LLM cost estimate,
- synthetic spend / generation budget.

Controls:

- global enable/disable,
- pause all,
- dry-run all,
- resume scheduler,
- emergency kill switch.

### 18.2 Agent List

Columns:

- avatar/name/user id,
- status,
- archetype,
- locale/timezone,
- runtime status,
- nextThinkAt,
- today's sessions/actions/comments,
- last action,
- consecutive failures,
- quick pause/resume,
- manual think/run.

Filters:

- status,
- archetype,
- locale,
- runtime status,
- error state,
- action type,
- created cohort.

### 18.3 Agent Detail

Tabs:

- Identity: bound user id, display name, avatar, profile provenance.
- Personality: tone, traits, interests, avoid topics.
- Activity: active windows, regularity, fatigue, nextThinkAt.
- Policy: enabled actions, weights, caps, risk gates.
- Memory: summaries, affinities, recent targets.
- Runtime: counters, visibleOnline, current session.
- Sessions: every session and decision reason.
- Actions: every atomic action and API result.
- Cost: LLM tokens, generation cost, synthetic ledger.
- Audit: admin edits and policy changes.

### 18.4 Bulk Operations

- Create agent cohort from template.
- Bind existing user ids.
- Generate names/avatars from approved templates.
- Apply policy to selected agents.
- Pause/resume cohort.
- Dry-run a cohort.
- Export logs.

Bulk creation defaults to `draft` until identities and policies are reviewed.

## 19. Admin APIs

All routes are admin-only and audited.

```text
GET    /admin/agent-users
POST   /admin/agent-users
GET    /admin/agent-users/:id
PATCH  /admin/agent-users/:id
POST   /admin/agent-users/:id/pause
POST   /admin/agent-users/:id/resume
POST   /admin/agent-users/:id/think-now
POST   /admin/agent-users/:id/run-session
POST   /admin/agent-users/:id/dry-run-session
GET    /admin/agent-users/:id/sessions
GET    /admin/agent-users/:id/actions
GET    /admin/agent-users/:id/memory
PATCH  /admin/agent-users/:id/policy
POST   /admin/agent-users/bulk
GET    /admin/agent-users/settings
PATCH  /admin/agent-users/settings
```

## 20. Technical Architecture

### 20.1 Server Module

Add:

```text
apps/server/src/agent-users/
  agent-users.module.ts
  agent-users-admin.controller.ts
  agent-users-admin.service.ts
  agent-users.service.ts
  agent-brain-scheduler.service.ts
  agent-brain.service.ts
  agent-session-worker.service.ts
  agent-action-executor.service.ts
  agent-policy.service.ts
  agent-targeting.service.ts
  agent-memory.service.ts
  agent-llm.service.ts
  agent-users.queue.ts
  dto.ts
  types.ts
```

Register `AgentUsersModule` in `apps/server/src/app.module.ts`.

### 20.2 Queue Design

Follow the existing BullMQ pattern in `apps/server/src/ai-generation`.

Queues:

- `agent-user-brain`
  - payload: `{ agentProfileId, op: "think" }`
  - short decision jobs.
- `agent-user-session`
  - payload: `{ sessionId }`
  - executes ordered session actions.
- `agent-user-maintenance`
  - payload: memory compaction, daily counter reset, stuck session cleanup.

The database is the source of truth. Queue payloads identify rows to re-read.

### 20.3 Scheduler

Scheduler loop:

```text
every 30-60s:
  read global settings
  if disabled: return
  claim due runtimes where nextThinkAt <= now
  mark claimed rows as thinking
  enqueue brain jobs
```

Multi-pod safety:

- claim rows in a transaction,
- use optimistic `where` updates or `FOR UPDATE SKIP LOCKED`,
- never enqueue the same runtime twice without an idempotency key.

## 21. Data Model

Prisma names below are the implementation target. Exact migration can adjust
index names to match schema conventions.

### 21.1 Enums

```prisma
enum AgentUserStatus {
  draft
  active
  paused
  disabled
  banned
}

enum AgentRuntimeStatus {
  offline
  sleeping
  thinking
  running
  online
  paused
  error
}

enum AgentSessionStatus {
  planned
  pending
  running
  completed
  failed
  cancelled
  skipped
}

enum AgentSessionIntent {
  browse
  social
  create
  play
  commerce
  mixed
}

enum AgentActionStatus {
  planned
  running
  succeeded
  failed
  skipped
  blocked
}
```

### 21.2 Models

```prisma
model AgentProfile {
  id               String          @id @default(uuid(7)) @db.Uuid
  userId           String          @unique @map("user_id") @db.VarChar(64)
  status           AgentUserStatus @default(draft)
  displayName      String          @map("display_name") @db.VarChar(120)
  avatarUrl        String?         @map("avatar_url") @db.VarChar(512)
  locale           String          @default("en-US") @db.VarChar(16)
  timezone         String          @default("UTC") @db.VarChar(64)
  archetype        String          @db.VarChar(64)
  personality      Json            @default("{}") @db.JsonB
  interests        Json            @default("[]") @db.JsonB
  activityModel    Json            @default("{}") @map("activity_model") @db.JsonB
  behaviorPolicy   Json            @default("{}") @map("behavior_policy") @db.JsonB
  budgetPolicy     Json            @default("{}") @map("budget_policy") @db.JsonB
  memory           Json            @default("{}") @db.JsonB
  metadata         Json            @default("{}") @db.JsonB
  createdByAdminId String?         @map("created_by_admin_id") @db.Uuid
  createdAt        DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime        @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)
  disabledAt       DateTime?       @map("disabled_at") @db.Timestamptz(6)

  runtime AgentRuntime?
  sessions AgentSession[]
  actions AgentActionLog[]

  @@index([status, updatedAt(sort: Desc)], map: "agent_profiles_status_recent_idx")
  @@index([archetype, status], map: "agent_profiles_archetype_status_idx")
  @@map("agent_profiles")
}

model AgentRuntime {
  id                  String             @id @default(uuid(7)) @db.Uuid
  agentProfileId       String             @unique @map("agent_profile_id") @db.Uuid
  status              AgentRuntimeStatus @default(sleeping)
  visibleOnline        Boolean            @default(false) @map("visible_online")
  schedulable          Boolean            @default(true)
  currentSessionId     String?            @map("current_session_id") @db.Uuid
  currentTaskId        String?            @map("current_task_id") @db.VarChar(128)
  nextThinkAt          DateTime?          @map("next_think_at") @db.Timestamptz(6)
  lastThinkAt          DateTime?          @map("last_think_at") @db.Timestamptz(6)
  lastWakeAt           DateTime?          @map("last_wake_at") @db.Timestamptz(6)
  lastSleepAt          DateTime?          @map("last_sleep_at") @db.Timestamptz(6)
  todayDate            DateTime?          @map("today_date") @db.Date
  todayActionCount     Int                @default(0) @map("today_action_count")
  todaySessionCount    Int                @default(0) @map("today_session_count")
  todayCommentCount    Int                @default(0) @map("today_comment_count")
  todaySpendMinor      BigInt             @default(0) @map("today_spend_minor")
  consecutiveFailures  Int                @default(0) @map("consecutive_failures")
  lastError            String?            @map("last_error") @db.Text
  memorySummary        String?            @map("memory_summary") @db.Text
  state                Json               @default("{}") @db.JsonB
  createdAt            DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime           @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  profile AgentProfile @relation(fields: [agentProfileId], references: [id], onDelete: Cascade)

  @@index([schedulable, status, nextThinkAt], map: "agent_runtime_due_idx")
  @@index([visibleOnline, updatedAt(sort: Desc)], map: "agent_runtime_online_idx")
  @@map("agent_runtimes")
}

model AgentSession {
  id              String             @id @default(uuid(7)) @db.Uuid
  agentProfileId  String             @map("agent_profile_id") @db.Uuid
  status          AgentSessionStatus @default(planned)
  intent          AgentSessionIntent @default(browse)
  plannedStartAt  DateTime?          @map("planned_start_at") @db.Timestamptz(6)
  actualStartAt   DateTime?          @map("actual_start_at") @db.Timestamptz(6)
  plannedEndAt    DateTime?          @map("planned_end_at") @db.Timestamptz(6)
  actualEndAt     DateTime?          @map("actual_end_at") @db.Timestamptz(6)
  actionBudget    Int                @default(5) @map("action_budget")
  decisionReason  String?            @map("decision_reason") @db.Text
  plan            Json               @default("[]") @db.JsonB
  contextSnapshot Json               @default("{}") @map("context_snapshot") @db.JsonB
  error           String?            @db.Text
  createdAt       DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime           @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  profile AgentProfile @relation(fields: [agentProfileId], references: [id], onDelete: Cascade)
  actions AgentActionLog[]

  @@index([agentProfileId, createdAt(sort: Desc)], map: "agent_sessions_profile_recent_idx")
  @@index([status, plannedStartAt], map: "agent_sessions_status_start_idx")
  @@map("agent_sessions")
}

model AgentActionLog {
  id              String            @id @default(uuid(7)) @db.Uuid
  agentProfileId  String            @map("agent_profile_id") @db.Uuid
  sessionId       String?           @map("session_id") @db.Uuid
  status          AgentActionStatus @default(planned)
  actionType      String            @map("action_type") @db.VarChar(64)
  targetType      String?           @map("target_type") @db.VarChar(64)
  targetId        String?           @map("target_id") @db.VarChar(128)
  idempotencyKey  String?           @map("idempotency_key") @db.VarChar(160)
  reason          String?           @db.Text
  input           Json              @default("{}") @db.JsonB
  output          Json              @default("{}") @db.JsonB
  cost            Json              @default("{}") @db.JsonB
  error           String?           @db.Text
  startedAt       DateTime?         @map("started_at") @db.Timestamptz(6)
  finishedAt      DateTime?         @map("finished_at") @db.Timestamptz(6)
  createdAt       DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)

  profile AgentProfile @relation(fields: [agentProfileId], references: [id], onDelete: Cascade)
  session AgentSession? @relation(fields: [sessionId], references: [id], onDelete: SetNull)

  @@unique([idempotencyKey], map: "agent_action_idempotency_key")
  @@index([agentProfileId, createdAt(sort: Desc)], map: "agent_actions_profile_recent_idx")
  @@index([actionType, status, createdAt(sort: Desc)], map: "agent_actions_type_status_idx")
  @@index([targetType, targetId, createdAt(sort: Desc)], map: "agent_actions_target_idx")
  @@map("agent_action_logs")
}
```

## 22. Identity and Account Provisioning

Target state:

- Agent Users are backed by real platform user accounts.
- Admin can bind existing prepared user ids.
- Admin can create a cohort through a controlled provisioning service once
  Java/user-system integration is available.
- Every generated account has internal provenance and cannot be mistaken for a
  human in admin, analytics, ledger, or safety tooling.

Open product decision:

- Whether public surfaces disclose AI-native identity. Internal provenance is
  mandatory either way.

## 23. Analytics and Finance Boundary

Every event and business table that can affect metrics must expose actor kind.

Required helper:

```ts
AgentUsersService.isAgentUser(userId): Promise<boolean>
```

Required event tag:

```text
actorKind = human | agent
```

Default behavior:

- dashboards exclude agents,
- referrals exclude agents,
- creator revenue excludes agents,
- rankings exclude agents,
- paid conversion excludes agents,
- billing reconciliation treats synthetic commerce separately,
- admin dashboards can explicitly include agents for simulation analysis.

Target state includes a synthetic ledger for simulated commerce and compute. It
must never be counted as real revenue.

## 24. Safety, Policy, and Moderation

Controls:

- global kill switch,
- dry-run mode,
- per-agent pause,
- per-cohort pause,
- action risk gates,
- public-text moderation,
- duplicate/near-duplicate comment detection,
- cooldowns after comments/follows/generation,
- consecutive-failure auto-pause,
- admin audit for every policy change.

Auto-pause triggers:

- forbidden action attempted,
- repeated executor failure,
- moderation failure rate above threshold,
- auth/permission anomaly,
- target visibility anomaly,
- missing required provider config,
- LLM output schema violations above threshold.

## 25. Observability

Admin and engineering need:

- due agents scanned per tick,
- brain decisions,
- sessions started/completed/failed,
- action counts by type/status,
- LLM calls/tokens/cost,
- moderation rejects,
- executor failure reasons,
- average nextThinkAt delay,
- stuck sessions,
- auto-paused agents,
- top targeted content,
- synthetic vs human event ratios.

Every action log should answer:

```text
Who acted?
Why did the system choose this action?
What target was selected?
What did the LLM produce, if anything?
What guard checks ran?
What API was called?
What happened?
What did it cost?
```

## 26. Evaluation and Quality

Agent quality needs evaluation, not just "it ran".

Evaluation dimensions:

- realism: does behavior look plausible over time?
- diversity: are agents meaningfully different?
- safety: did policy block risky outputs?
- usefulness: did activity improve target product loops?
- metric hygiene: did dashboards correctly exclude agents?
- cost: are LLM and generation costs within budget?
- content quality: are comments specific, short, non-repetitive?

Add offline review flows in admin:

- sample recent comments,
- inspect bad sessions,
- compare archetypes,
- review repeated targets,
- approve policy changes.

## 27. Region and Environment

Region behavior follows existing deployment split:

- `.com` and `.cn` can have separate agent populations.
- Region-specific model providers and content rules are allowed.
- No cross-region copying of user identities or private content.
- Global defaults live in code, operational settings live in DB/admin config.
- Required provider keys fail loud when an enabled action needs them.

## 28. Delivery Roadmap

This roadmap is implementation sequencing only. It does not reduce the target
product scope above.

### Slice 1: Foundation

- Prisma schema and migration.
- `AgentUsersModule`.
- Admin settings and kill switch.
- Bind existing user ids.
- Create/list/edit/pause/resume agents.
- Dry-run brain decisions and sessions.

### Slice 2: Runtime

- `nextThinkAt` scheduler.
- Brain queue and session queue.
- Rule-based planner.
- Session/action logs.
- Manual `think-now` and `run-session`.

### Slice 3: Low-Risk Product Actions

- read/browse/view actions,
- like/favorite/follow through real APIs,
- idempotency and rate caps,
- analytics `actorKind` tagging for touched surfaces.

### Slice 4: LLM Text

- `AgentUserLlmService`,
- comment generation,
- moderation and duplicate guard,
- admin review of generated text,
- memory summary updates.

### Slice 5: Creation and Game Loops

- private draft creation,
- private generation with synthetic compute budget,
- story-game/player sessions,
- no public publish until provenance, takedown, and review are complete.

### Slice 6: Commerce Simulation

- offer browsing,
- wishlist,
- simulated checkout,
- synthetic ledger,
- finance dashboards proving zero real revenue pollution.

### Slice 7: Advanced Autonomy

- goal-driven sessions,
- relationship memory,
- cohort experiments,
- policy/eval dashboards,
- optional Dragonlings branding.

## 29. Open Product Decisions

- Public label: internal-only provenance or visible AI-native identity?
- Initial surfaces: IP community, works feed, story-game runtime, studio gallery,
  or mobile first?
- Identity provisioning: bind existing accounts first or build admin-only account
  creation bridge?
- Comment policy: which surfaces allow agent public comments first?
- Synthetic commerce: what exact finance language and dashboard treatment?
- Population size: initial count by region and archetype.
- Branding: keep "Agent User" internal or introduce "Dragonlings" externally.

## 30. Target-State Summary

Agent User System is a full synthetic-user operating layer:

```text
real user account
  + internal agent provenance
  + personality and memory
  + activity model
  + policy-bounded LLM brain
  + session/action executor
  + real product APIs
  + synthetic finance boundary
  + admin console
  + permanent audit trail
```

The end state is not a safer cron script. The end state is an AI-native user
population that can participate in FizzDragon's product world while remaining
fully governable, observable, and excluded from human business truth by default.
