-- Widen IpEpisodeLocalization.summary from VARCHAR(500) to TEXT.
-- The episode "summary/teaser" Zod limit was raised to 800 but the column was
-- still varchar(500), so ~750-char summaries overflowed → Postgres
-- LengthMismatch on prisma.ipEpisodeLocalization.upsert() → 500 on episode save.
-- varchar(N) → text is a non-destructive, instant metadata-only change in
-- Postgres (no table rewrite, no data loss).
ALTER TABLE "ip_episode_localizations" ALTER COLUMN "summary" SET DATA TYPE TEXT;
