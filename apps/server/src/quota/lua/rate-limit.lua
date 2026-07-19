-- Atomic fixed-window rate admission for QuotaService.checkChatRate().
--
-- KEYS[1] = minute counter key
-- ARGV[1] = TTL seconds
--
-- Returns the counter value after this admission. INCR and expiry repair are
-- one Redis operation, so a pod crash cannot leave a permanent rate key.

local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local used = redis.call("INCR", key)
local remaining_ttl = redis.call("TTL", key)
if used == 1 or remaining_ttl < 0 then
  redis.call("EXPIRE", key, ttl)
end
return used
