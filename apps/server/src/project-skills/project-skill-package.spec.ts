import { zipSync, strToU8 } from 'fflate';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseProjectSkillPackage } from './project-skill-package';

function file(name: string, buffer: Buffer) {
  return {
    originalname: name,
    mimetype: name.endsWith('.zip') ? 'application/zip' : 'text/markdown',
    size: buffer.length,
    buffer,
  };
}

const SKILL_MD = `---
name: careful-camera
description: A controlled camera direction skill.
---
# Careful Camera

Use deliberate blocking and preserve explicit subject identity.`;

function expectInvalidPackage(buffer: Buffer, message: string) {
  try {
    parseProjectSkillPackage(file('skill.zip', buffer));
    throw new Error('Expected the package to be rejected.');
  } catch (error) {
    expect((error as { response?: { msg?: string } }).response?.msg).toContain(
      message,
    );
  }
}

describe('parseProjectSkillPackage', () => {
  it('parses a single SKILL.md without treating it as executable code', () => {
    const parsed = parseProjectSkillPackage(
      file('SKILL.md', Buffer.from(SKILL_MD)),
    );

    expect(parsed).toMatchObject({
      packageName: 'careful-camera',
      displayName: 'Careful Camera',
      slugBase: 'careful-camera',
      sourceFiles: ['SKILL.md'],
    });
    expect(parsed.instructions).toContain('project-owned creative guidance');
    expect(parsed.instructions).toContain('Use deliberate blocking');
  });

  it('keeps the downloadable template importable by this parser', () => {
    const buffer = readFileSync(
      resolve(__dirname, '../../../studio/public/skills/templates/SKILL.md'),
    );
    const parsed = parseProjectSkillPackage(file('SKILL.md', buffer));

    expect(parsed).toMatchObject({
      packageName: 'cinematic-visual-direction',
      displayName: 'Cinematic Visual Direction',
      sourceFiles: ['SKILL.md'],
    });
  });

  it('imports Markdown references from a bounded ZIP package', () => {
    const zipped = zipSync({
      'camera-skill/SKILL.md': strToU8(SKILL_MD),
      'camera-skill/references/lenses.md': strToU8(
        '# Lenses\n\nPrefer a normal lens unless the user says otherwise.',
      ),
    });

    const parsed = parseProjectSkillPackage(
      file('camera-skill.zip', Buffer.from(zipped)),
    );

    expect(parsed.sourceFiles).toEqual([
      'camera-skill/SKILL.md',
      'camera-skill/references/lenses.md',
    ]);
    expect(parsed.instructions).toContain('## Reference: references/lenses.md');
  });

  it('rejects JavaScript frontmatter before it can be evaluated', () => {
    const sentinel = '__projectSkillFrontmatterExecuted';
    delete (globalThis as Record<string, unknown>)[sentinel];
    const malicious = `---js
(() => {
  globalThis.${sentinel} = true;
  return { name: 'unsafe', description: 'unsafe' };
})()
---
# Unsafe

Never execute this.`;

    try {
      parseProjectSkillPackage(file('SKILL.md', Buffer.from(malicious)));
      throw new Error('Expected the package to be rejected.');
    } catch (error) {
      expect(
        (error as { response?: { msg?: string } }).response?.msg,
      ).toContain('plain YAML frontmatter');
    }
    expect((globalThis as Record<string, unknown>)[sentinel]).toBeUndefined();
  });

  it('rejects executable or binary files instead of silently ignoring them', () => {
    const zipped = zipSync({
      'camera-skill/SKILL.md': strToU8(SKILL_MD),
      'camera-skill/scripts/run.sh': strToU8('exit 1'),
    });

    expectInvalidPackage(
      Buffer.from(zipped),
      'only SKILL.md and Markdown files under references/',
    );
  });

  it('rejects directory traversal paths', () => {
    const zipped = zipSync({
      '../SKILL.md': strToU8(SKILL_MD),
    });

    expectInvalidPackage(Buffer.from(zipped), 'unsafe file path');
  });

  it('rejects symbolic links', () => {
    const zipped = zipSync({
      'skill/SKILL.md': [
        strToU8(SKILL_MD),
        { os: 3, attrs: (0o120777 << 16) >>> 0 },
      ],
    });

    expectInvalidPackage(
      Buffer.from(zipped),
      'only regular Markdown files and directories',
    );
  });

  it('rejects duplicate paths after case and Unicode normalization', () => {
    const zipped = zipSync({
      'skill/SKILL.md': strToU8(SKILL_MD),
      'skill/skill.md': strToU8(SKILL_MD),
    });

    expectInvalidPackage(Buffer.from(zipped), 'duplicate file paths');
  });

  it('rejects archives with more than the bounded number of entries', () => {
    const entries: Record<string, Uint8Array> = {
      'skill/SKILL.md': strToU8(SKILL_MD),
    };
    for (let index = 0; index < 64; index += 1) {
      entries[`skill/references/${index}.md`] = strToU8(`# Reference ${index}`);
    }

    expectInvalidPackage(Buffer.from(zipSync(entries)), 'at most 64 entries');
  });

  it('rejects ambiguous packages containing more than one SKILL.md', () => {
    const zipped = zipSync({
      'one/SKILL.md': strToU8(SKILL_MD),
      'two/SKILL.md': strToU8(SKILL_MD),
    });

    expectInvalidPackage(Buffer.from(zipped), 'exactly one SKILL.md');
  });

  it('rejects compressed packages whose expanded data exceeds the limit', () => {
    const zipped = zipSync({
      'skill/SKILL.md': strToU8(SKILL_MD),
      'skill/references/oversized.md': new Uint8Array(2_097_000),
    });

    expect(zipped.length).toBeLessThan(1_048_576);
    expectInvalidPackage(
      Buffer.from(zipped),
      'expanded Skill package must be 2 MB or smaller',
    );
  });
});
