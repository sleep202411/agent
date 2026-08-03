import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Story Studio interactive-film cutover migration', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../prisma/migrations/20260802190000_story_studio_interactive_film_only/migration.sql',
    ),
    'utf8',
  );

  it('retires removed formats without truncating interactive-film projects', () => {
    expect(sql).not.toMatch(/TRUNCATE\s+TABLE\s+"?story_projects"?/i);
    expect(sql).toContain('WHERE "format" <> \'interactive_film\'');
    expect(sql).toContain('CREATE TEMP TABLE "retired_story_projects"');
    expect(sql).toContain('DELETE FROM "story_projects" AS "project"');
  });

  it('removes immutable release and build rows only through the retired scope', () => {
    for (const table of [
      'story_experience_publications',
      'story_experience_game_releases',
      'story_build_assets',
      'story_builds',
      'story_revisions',
      'story_video_upload_sessions',
    ]) {
      expect(sql).toContain(`DELETE FROM "${table}"`);
    }

    expect(sql).toContain('DISABLE TRIGGER USER');
    expect(sql).toContain('ENABLE TRIGGER USER');
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
  });
});
