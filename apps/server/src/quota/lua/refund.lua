-- Atomic refund for QuotaService.refund().
--
-- KEYS[1] = day counter key
-- KEYS[2] = month counter key
-- KEYS[3] = idempotency key
--
-- ARGV[1] = cost to refund (positive integer)
-- ARGV[2] = terminal fence ("1" writes permanent FINAL_REFUNDED even when
--           no consume record exists; "0" preserves generic retry semantics)
--
-- Returns ARRAY:
--   { status, day_used, day_existed }
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
local terminal  = ARGV[2] == "1"

local prior = redis.call("GET", idem_key)
if not prior then
  if terminal then
    redis.call("SET", idem_key, "FINAL_REFUNDED")
  end
  local day_value = redis.call("GET", day_key)
  return { "no_idem", tostring(tonumber(day_value or "0")), day_value and "1" or "0" }
end
if prior == "FINAL_REFUNDED" then
  local day_value = redis.call("GET", day_key)
  return { "already", tostring(tonumber(day_value or "0")), day_value and "1" or "0" }
end
if prior == "REFUNDED" then
  if terminal then
    redis.call("SET", idem_key, "FINAL_REFUNDED")
  end
  local day_value = redis.call("GET", day_key)
  return { "already", tostring(tonumber(day_value or "0")), day_value and "1" or "0" }
end

-- Expired windows are skipped rather than recreated as persistent zero or
-- negative counters. Month lives for 40d, so a <=168h Copilot expiry still
-- refunds the original monthly bucket even after its 36h day key is gone.
local day_value = redis.call("GET", day_key)
local new_day = tonumber(day_value or "0")
if day_value then
  new_day = redis.call("DECRBY", day_key, cost)
  if new_day < 0 then
    redis.call("SET", day_key, "0", "KEEPTTL")
    new_day = 0
  end
end

local month_value = redis.call("GET", month_key)
if month_value then
  local new_month = redis.call("DECRBY", month_key, cost)
  if new_month < 0 then
    redis.call("SET", month_key, "0", "KEEPTTL")
  end
end

if terminal then
  redis.call("SET", idem_key, "FINAL_REFUNDED")
else
  redis.call("SET", idem_key, "REFUNDED", "KEEPTTL")
end
return { "ok", tostring(new_day), day_value and "1" or "0" }
