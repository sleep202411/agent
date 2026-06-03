-- Convert the SGWander competition from a (hidden) GENRE to a (hidden) TAG.
--
-- Rationale: a competition is a cross-cutting label, not a content genre. It was
-- modelled as a hidden genre only to reuse the plaza's hidden-genre exclusion.
-- This re-models it as a tag while preserving behaviour exactly: the 113 entries
-- become genre-less (a tolerated state — many migrated IPs already are) and stay
-- hidden from public browse (a hidden non-genre term + no active genre is still
-- excluded by listPublicIps). No IP row is touched; no assignment is lost.
--
-- Idempotent + atomic (single DO block). Re-running is a no-op once the genre
-- term is gone. Already applied to prod-com manually on 2026-06-03 (113 entries,
-- 3 localizations); this file records it for reproducibility + other envs.
--
-- Reverse (if ever needed): flip the term back to type='genre' and re-point the
-- assignments — the inverse of the steps below.
DO $$
DECLARE
  v_genre_id uuid;
  v_tag_id   uuid;
  v_moved    int;
BEGIN
  SELECT id INTO v_genre_id FROM ip_taxonomy_terms
   WHERE type = 'genre' AND code = 'sgwander_ai_challenge';
  IF v_genre_id IS NULL THEN
    RAISE NOTICE 'sgwander genre term absent — already converted; nothing to do';
    RETURN;
  END IF;

  -- 1) tag term (same code; reuse if a prior partial run created it). The
  --    (type, code) unique lets a tag and genre share the code, so this is safe.
  SELECT id INTO v_tag_id FROM ip_taxonomy_terms
   WHERE type = 'tag' AND code = 'sgwander_ai_challenge';
  IF v_tag_id IS NULL THEN
    v_tag_id := gen_random_uuid();
    INSERT INTO ip_taxonomy_terms
      (id, type, code, status, display_order, metadata, created_by_id, updated_by_id, created_at, updated_at, archived_at)
    SELECT v_tag_id, 'tag', code, status, display_order, metadata, created_by_id, updated_by_id, created_at, now(), archived_at
      FROM ip_taxonomy_terms WHERE id = v_genre_id;
  END IF;

  -- 2) copy localizations to the tag (skip locales already present on the tag).
  INSERT INTO ip_taxonomy_term_localizations
    (id, term_id, locale, label, description, aliases, created_at, updated_at)
  SELECT gen_random_uuid(), v_tag_id, l.locale, l.label, l.description, l.aliases, l.created_at, now()
    FROM ip_taxonomy_term_localizations l
   WHERE l.term_id = v_genre_id
     AND NOT EXISTS (
       SELECT 1 FROM ip_taxonomy_term_localizations t
        WHERE t.term_id = v_tag_id AND t.locale = l.locale);

  -- 3) re-point IP assignments genre -> tag (preserves source / display_order /
  --    metadata / created_by_id). Guard the (ip_id, term_id) unique.
  UPDATE ip_taxonomy_assignments a
     SET term_id = v_tag_id
   WHERE a.term_id = v_genre_id
     AND NOT EXISTS (
       SELECT 1 FROM ip_taxonomy_assignments b
        WHERE b.ip_id = a.ip_id AND b.term_id = v_tag_id);
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RAISE NOTICE 'sgwander: re-pointed % assignments genre -> tag', v_moved;

  -- drop any redundant leftover (an IP that already had the tag) — none expected.
  DELETE FROM ip_taxonomy_assignments WHERE term_id = v_genre_id;

  -- 4) remove the genre term; its localizations cascade away => zero residue.
  DELETE FROM ip_taxonomy_terms WHERE id = v_genre_id;
END $$;
