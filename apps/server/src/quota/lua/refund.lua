-- Atomic refund for QuotaService.refund().
--
-- KEYS[1] = day counter key
-- KEYS[2] = month counter key
-- KEYS[3] = idempotency key
--
-- ARGV[1] = cost to refund (positive integer)
--
-- Returns ARRAY:
--   { status, day_used }
--
--   status   = "ok"           — refund applied
--            | "no_idem"      — no idempotency record; nothing to refund
--            | "already"      — already refunded
--
-- We use the idempotency record as a refund ledger: the stored value
-- (set by consume.lua to day_used at the time) is rewritten to the
-- literal "REFUNDED" once we refund. Subsequent refund calls with the
-- same key are no-ops.

local day_key   = KEYS[1]
local month_key = KEYS[2]
local idem_key  = KEYS[3]

local cost      = tonumber(ARGV[1])

local prior = redis.call("GET", idem_key)
if not prior then
  return { "no_idem", tostring(tonumber(redis.call("GET", day_key) or "0")) }
end
if prior == "REFUNDED" then
  return { "already", tostring(tonumber(redis.call("GET", day_key) or "0")) }
end

local new_day = redis.call("DECRBY", day_key, cost)
if new_day < 0 then
  -- Counter went negative — clamp to 0 (TTL probably reset between
  -- consume and refund). This is the only place where day/month can
  -- drift; in practice the counter just bottoms out and life goes on.
  redis.call("SET", day_key, "0", "KEEPTTL")
  new_day = 0
end
redis.call("DECRBY", month_key, cost)
-- Same clamp for month counter — silently fix-up.
local new_month = tonumber(redis.call("GET", month_key) or "0")
if new_month < 0 then
  redis.call("SET", month_key, "0", "KEEPTTL")
end

redis.call("SET", idem_key, "REFUNDED", "KEEPTTL")
return { "ok", tostring(new_day) }
