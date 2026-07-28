-- The preceding safety check proves that the same-named object is a
-- usable three-key partial unique index. PostgreSQL's `IF NOT EXISTS`
-- matches indexes by name only, though, so an operator-created index
-- could still have three different columns or a broader predicate and
-- pass that structural check.
--
-- Verify the exact definition expected by ConversationsService before
-- allowing the deployment to proceed. This is intentionally a new
-- migration instead of editing the already-applied check: migration
-- history is immutable once any environment has recorded its checksum.

DO $$
DECLARE
  index_definition_matches BOOLEAN;
BEGIN
  SELECT
    i.indisvalid
    AND i.indisready
    AND i.indisunique
    AND i.indnkeyatts = 3
    AND ARRAY(
      SELECT a.attname
      FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS key(attnum, ordinal)
      JOIN pg_attribute AS a
        ON a.attrelid = i.indrelid
       AND a.attnum = key.attnum
      WHERE key.ordinal <= i.indnkeyatts
      ORDER BY key.ordinal
    ) = ARRAY['conversation_id', 'author_id', 'client_key']::name[]
    AND pg_get_expr(i.indpred, i.indrelid) = '(client_key IS NOT NULL)'
  INTO index_definition_matches
  FROM pg_index AS i
  WHERE i.indexrelid =
    to_regclass('public.messages_client_key_unique');

  IF COALESCE(index_definition_matches, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION
      'messages_client_key_unique must be UNIQUE (conversation_id, author_id, client_key) WHERE client_key IS NOT NULL';
  END IF;
END
$$;
