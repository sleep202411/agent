-- Admission takes four advisory locks (global, workspace, actor, provider lane)
-- and then aggregates the capacity-holding rows once per axis while holding all
-- of them. The workspace and provider axes are already served by
-- "agent_platform_invocations_workspace_active_idx" and
-- "..._provider_active_idx"; the global axis had no index at all and
-- "..._owner_recent_idx" carries no status column, so those two aggregates
-- degraded into scans of a table that gains a row per invocation and is never
-- pruned. Because 'agent-admission:global' is held throughout, every concurrent
-- admission waits behind that scan, so the cost is paid platform-wide.
--
-- The index is PARTIAL on exactly the capacity-holding statuses, which is what
-- makes it stay small: AGENT_ADMISSION_MAX_ACTIVE_GLOBAL bounds the live set, so
-- this index holds that many entries permanently however large the table grows.
-- A full index on "status" would grow with the table and reintroduce the
-- problem. INCLUDE carries the two summed columns so the aggregate never has to
-- touch the heap.
--
-- Keep the predicate in sync with CAPACITY_HOLDING_STATUSES in
-- apps/server/src/agent-platform-gateway/agent-platform-invocation.service.ts —
-- the planner only uses a partial index when the query's filter is provably
-- implied by this predicate, so a divergence silently returns to a sequential
-- scan rather than failing.
--
-- Not declared in schema.prisma: Prisma's DSL cannot express a partial index or
-- INCLUDE, the same reason "agent_platform_conversations_one_active_scope_unique"
-- lives only here.
CREATE INDEX "agent_platform_invocations_active_capacity_idx"
  ON "agent_platform_invocations" ("status", "owner_actor_id")
  INCLUDE ("reserved_token_units", "reserved_cost_microusd")
  WHERE "status" IN (
    'admitting'::"AgentPlatformInvocationStatus",
    'queued'::"AgentPlatformInvocationStatus",
    'running'::"AgentPlatformInvocationStatus",
    'waiting_for_approval'::"AgentPlatformInvocationStatus"
  );
