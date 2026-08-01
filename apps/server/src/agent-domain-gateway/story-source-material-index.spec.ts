import {
  buildStorySourceMaterialIndex,
  parsePersistedStorySourceMaterialIndex,
  projectStorySourceMaterial,
  queryStorySourceMaterial,
  STORY_SOURCE_MATERIAL_INDEX_SCHEMA_VERSION,
  StorySourceMaterialQueryArgumentsSchema,
} from './story-source-material-index';

describe('Story source material index', () => {
  it('indexes a 70,000-character screenplay without placing the whole script in model context', () => {
    const scene = [
      '内景·林家客厅 - 夜',
      '林夕：你听见楼上的声音了吗？',
      '周野：听见了。我们得在天亮前找到那封信。',
      '随后，灯光熄灭。林夕走向楼梯，周野留在门边。',
      '',
      '外景·旧火车站 - 清晨',
      '林夕：这里和照片里一模一样。',
      '周野：不，钟上的时间不一样。',
      '与此同时，远处传来列车鸣笛。',
      '',
    ].join('\n');
    const text = Array.from(
      { length: Math.ceil(70_000 / scene.length) },
      () => scene,
    )
      .join('\n')
      .slice(0, 70_000);
    const index = buildStorySourceMaterialIndex({
      text,
      fileName: '完整剧本.txt',
      contentHash: 'a'.repeat(64),
    });
    const projection = projectStorySourceMaterial(index, text);

    expect(index.document).toMatchObject({
      format: 'screenplay',
      characterCount: 70_000,
    });
    expect(index.document.chunkCount).toBeGreaterThan(20);
    expect(index.entities.characters.map((item) => item.name)).toEqual(
      expect.arrayContaining(['林夕', '周野']),
    );
    expect(index.entities.locations.map((item) => item.name)).toEqual(
      expect.arrayContaining(['林家客厅', '旧火车站']),
    );
    expect(index.continuity.temporalCues.length).toBeGreaterThan(0);
    expect(projection.representativeExcerpts).toHaveLength(5);

    const serialized = JSON.stringify(projection);
    expect(serialized.length).toBeLessThan(20_000);
    expect(serialized).not.toContain(text);
  });

  it('retrieves bounded, relevant chunks and supports deterministic range pagination', () => {
    const sections = Array.from({ length: 180 }, (_, index) =>
      [
        `# 第${index + 1}章`,
        index === 47
          ? '许愿井里的蓝色钥匙揭示了祖母留下的秘密地图。'
          : `这是第${index + 1}章的普通场景，人物继续前进。`,
        '人物讨论眼前的选择，然后离开。',
      ].join('\n\n'),
    );
    const text = sections.join('\n\n');
    const index = buildStorySourceMaterialIndex({
      text,
      fileName: 'novel.md',
      contentHash: 'b'.repeat(64),
    });
    const query = StorySourceMaterialQueryArgumentsSchema.parse({
      schemaVersion: 'story-source-material-query/v1',
      attachmentId: '0197f4a2-0800-7000-8000-000000000009',
      mode: 'search',
      query: '祖母留下的蓝色钥匙在哪里？',
      limit: 4,
    });
    const result = queryStorySourceMaterial({
      attachmentId: query.attachmentId,
      text,
      index,
      query,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0]?.text).toContain('蓝色钥匙');
    expect(result.overview).toBeNull();
    expect(result).not.toHaveProperty('projection');
    expect(
      result.chunks.reduce((total, chunk) => total + chunk.text.length, 0),
    ).toBeLessThanOrEqual(24_000);

    const firstPage = queryStorySourceMaterial({
      attachmentId: query.attachmentId,
      text,
      index,
      query: StorySourceMaterialQueryArgumentsSchema.parse({
        schemaVersion: 'story-source-material-query/v1',
        attachmentId: query.attachmentId,
        mode: 'range',
        limit: 2,
      }),
    });
    expect(firstPage.nextCursor).not.toBeNull();
    expect(firstPage.overview).toBeNull();
    const secondPage = queryStorySourceMaterial({
      attachmentId: query.attachmentId,
      text,
      index,
      query: StorySourceMaterialQueryArgumentsSchema.parse({
        schemaVersion: 'story-source-material-query/v1',
        attachmentId: query.attachmentId,
        mode: 'range',
        cursor: firstPage.nextCursor,
        limit: 2,
      }),
    });
    expect(secondPage.chunks[0]?.ordinal).toBe(2);

    const overview = queryStorySourceMaterial({
      attachmentId: query.attachmentId,
      text,
      index,
      query: StorySourceMaterialQueryArgumentsSchema.parse({
        schemaVersion: 'story-source-material-query/v1',
        attachmentId: query.attachmentId,
        mode: 'overview',
        limit: 3,
      }),
    });
    expect(overview.overview?.hierarchy.length).toBeGreaterThan(0);
    expect(overview.overview).not.toHaveProperty('representativeExcerpts');
    expect(overview).not.toHaveProperty('projection');
  });

  it('requires an explicit query for semantic and entity retrieval modes', () => {
    expect(() =>
      StorySourceMaterialQueryArgumentsSchema.parse({
        schemaVersion: 'story-source-material-query/v1',
        attachmentId: '0197f4a2-0800-7000-8000-000000000009',
        mode: 'search',
      }),
    ).toThrow(/query is required/u);
  });

  it('accepts only a persisted index that matches its immutable source identity', () => {
    const text = '# 第一章\n\n林夕在火车站找到一把蓝色钥匙。';
    const contentHash = 'c'.repeat(64);
    const index = buildStorySourceMaterialIndex({
      text,
      fileName: 'story.md',
      contentHash,
    });

    expect(
      parsePersistedStorySourceMaterialIndex({
        value: JSON.parse(JSON.stringify(index)),
        schemaVersion: STORY_SOURCE_MATERIAL_INDEX_SCHEMA_VERSION,
        expectedContentHash: contentHash,
        expectedCharacterCount: text.length,
      }),
    ).toEqual(index);
    expect(() =>
      parsePersistedStorySourceMaterialIndex({
        value: index,
        schemaVersion: STORY_SOURCE_MATERIAL_INDEX_SCHEMA_VERSION,
        expectedContentHash: 'd'.repeat(64),
        expectedCharacterCount: text.length,
      }),
    ).toThrow(/does not match its source/u);
  });
});
