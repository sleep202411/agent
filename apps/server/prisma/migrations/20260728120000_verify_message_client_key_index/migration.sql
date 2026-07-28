-- `CREATE INDEX CONCURRENTLY ... IF NOT EXISTS` escape-hatch builds can
-- leave an INVALID same-named index after interruption. PostgreSQL then
-- lets the later `IF NOT EXISTS` migration skip it even though it enforces
-- no idempotency. Fail deployment loudly unless the final object is a
-- ready, valid, unique, three-key partial index.

DO $$
DECLARE
  index_is_usable BOOLEAN;
BEGIN
  SELECT
    i.indisvalid
    AND i.indisready
    AND i.indisunique
    AND i.indnkeyatts = 3
    AND i.indpred IS NOT NULL
  INTO index_is_usable
  FROM pg_index AS i
  WHERE i.indexrelid =
    to_regclass('public.messages_client_key_unique');

  IF COALESCE(index_is_usable, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION
      'messages_client_key_unique must be a valid, ready, unique partial index';
  END IF;
END
$$;
