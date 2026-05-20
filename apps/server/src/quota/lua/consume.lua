-- Atomic check-and-incr for QuotaService.consume().
--
-- KEYS[1] = day counter key   (e.g. quota:2259:image:day:2026-05-20)
-- KEYS[2] = month counter key (e.g. quota:2259:image:month:2026-05)
-- KEYS[3] = idempotency key   (e.g. quota:idem:<uuid>)
--
-- ARGV[1] = cost (integer >= 1)
-- ARGV[2] = day limit (integer; -1 = unlimited)
-- ARGV[3] = day TTL seconds
-- ARGV[4] = month TTL seconds
-- ARGV[5] = idempotency TTL seconds (0 disables dedup)
--
-- Returns ARRAY:
--   { status, day_used, day_limit, deduped }
--
--   status   = "ok" | "exceeded"
--   day_used = day counter value AFTER this op (still incremented even
--              on dedup, with a no-op increment of 0 so the value is
--              accurate)
--   deduped  = "1" if same idempotency key already consumed, "0" otherwise
--
-- Why one script: a naive "GET → check → INCR" risks a race where two
-- concurrent server pods both see used=4 of 5 and both INCR to 5 (or
-- worse, 6 if both succeed). Atomically doing the check + incr inside
-- a Lua block on Redis side closes that race. SCRIPT LOAD'd once on
-- service init; EVALSHA after = single round-trip.

local day_key   = KEYS[1]
local month_key = KEYS[2]
local idem_key  = KEYS[3]

local cost      = tonumber(ARGV[1])
local day_limit = tonumber(ARGV[2])
local day_ttl   = tonumber(ARGV[3])
local month_ttl = tonumber(ARGV[4])
local idem_ttl  = tonumber(ARGV[5])

-- Idempotency check — same key in TTL window = no-op.
local deduped = "0"
if idem_ttl > 0 and idem_key ~= "" then
  local prior = redis.call("GET", idem_key)
  if prior then
    -- Already consumed for this op key; return current snapshot.
    local cur = tonumber(redis.call("GET", day_key) or "0")
    return { "ok", tostring(cur), tostring(day_limit), "1" }
  end
end

-- Quota check (unlimited dimensions skip the check; -1 sentinel).
local current = tonumber(redis.call("GET", day_key) or "0")
if day_limit >= 0 and current + cost > day_limit then
  return { "exceeded", tostring(current), tostring(day_limit), "0" }
end

-- Consume — day + month counters in lock-step.
local new_day = redis.call("INCRBY", day_key, cost)
redis.call("EXPIRE", day_key, day_ttl)
redis.call("INCRBY", month_key, cost)
redis.call("EXPIRE", month_key, month_ttl)

if idem_ttl > 0 and idem_key ~= "" then
  redis.call("SET", idem_key, tostring(new_day), "EX", idem_ttl)
end

return { "ok", tostring(new_day), tostring(day_limit), deduped }
