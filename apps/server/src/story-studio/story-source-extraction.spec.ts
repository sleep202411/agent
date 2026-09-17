import {
  assembleSourceScreenplay,
  documentFromStorySource,
  indexStorySource,
  normalizeSourceExtraction,
  sourceExtractionAuditView,
  sourceAuditScopes,
  sourcePassage,
  sourceNarrativeAnchors,
  partitionStorySource,
  storySourceBoundarySchemaFor,
  storySourceBatchSchemaFor,
  storySourceRoutingRepairSchemaFor,
  decodeSourceBatch,
  validateSourceBatch,
  validateSourceExtraction,
  validateSourceAudit,
  applySourceRoutingRepair,
  applySourceLinearSpine,
  type StorySourceExtraction,
} from './story-source-extraction';
import { compileScreenplayToStoryOperations } from './story-authoring-pipeline.service';
import { StoryPatchOperationSchema } from '@repo/shared/story-agent';
import { z } from 'zod';

const source =
  '  原稿标题  \n\n铜符是圆圈内三条放射状直线。\n沈千户说：“查看铜符”。\n信任达到二点才进入结局。\n结局：火种。';
const plan = (): StorySourceExtraction => ({
  title: '原稿标题',
  logline: '调查铜符。',
  synopsis: '主角调查铜符。',
  characters: [],
  entrySceneId: 'opening',
  scenes: [
    {
      nodeId: 'opening',
      name: '铜符',
      heading: '值房',
      beat: '调查铜符',
      start: 1,
      exit: {
        kind: 'unresolved',
        reason: '信任条件尚未实现。',
        targetNodeIds: ['ending'],
      },
    },
    {
      nodeId: 'ending',
      name: '火种',
      heading: '结局',
      beat: '火种',
      start: 4,
      exit: { kind: 'auto', nextNodeId: null },
    },
  ],
  context: [{ start: 0, reason: '标题' }],
  unsupportedRules: [
    {
      source: { start: 3, end: 3 },
      nodeIds: ['opening'],
      affectsRouting: true,
      explanation: '信任条件尚未实现。',
    },
  ],
});

describe('faithful source extraction', () => {
  it('derives routing scope from the wire exit while keeping incoming prerequisites as notes', () => {
    const segments = [
      { nodeId: 'source_0', start: 0, end: 0 },
      { nodeId: 'source_1', start: 1, end: 1 },
    ];
    const blocks = indexStorySource('依据已选立场派生分支。\n决定递送方式。');
    const schema = storySourceBatchSchemaFor([segments[0]], segments, blocks);
    const detail = {
      notes: [
        {
          source: { start: 0, end: 0 },
          explanation: '前一抉选择了呈皇帝才进入此分支。',
        },
      ],
      exit: { kind: 'auto', nextNodeId: 'source_1' },
    };
    expect(
      schema.parse({ source_0: detail }).source_0.unsupportedRules,
    ).toEqual([{ ...detail.notes[0], affectsRouting: false }]);
    const exit = {
      kind: 'unresolved',
      reason: '依据已选立场派生分支。',
      targetNodeIds: ['source_1'],
      ruleSource: { start: 0, end: 0 },
    };
    const parsed = schema.parse({ source_0: { ...detail, exit } }).source_0;
    expect(parsed.exit).toEqual({
      kind: 'unresolved',
      reason: exit.reason,
      targetNodeIds: ['source_1'],
    });
    expect(parsed.unsupportedRules).toContainEqual({
      source: exit.ruleSource,
      explanation: exit.reason,
      affectsRouting: true,
    });
    const withoutSource = {
      kind: exit.kind,
      reason: exit.reason,
      targetNodeIds: exit.targetNodeIds,
    };
    expect(
      schema.safeParse({ source_0: { ...detail, exit: withoutSource } })
        .success,
    ).toBe(false);
  });

  it('decodes unique keyed wire repairs into sparse internal patches', () => {
    const schema = storySourceRoutingRepairSchemaFor([
      { nodeId: 'opening', start: 0, end: 0 },
      { nodeId: 'ending', start: 1, end: 1 },
    ]);
    const patch = {
      exit: { kind: 'auto', nextNodeId: 'ending' },
      notes: [],
    };
    expect(schema.parse({ patches: { opening: patch, ending: null } })).toEqual(
      {
        patches: [
          { nodeId: 'opening', exit: patch.exit, unsupportedRules: [] },
        ],
      },
    );
    expect(
      schema.safeParse({ patches: { opening: null, ending: null } }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        patches: { opening: patch, ending: null, invented: patch },
      }).success,
    ).toBe(false);
    expect(() =>
      z.toJSONSchema(schema, { io: 'input', reused: 'ref' }),
    ).not.toThrow();
  });

  it('rejects reachable graphs that play mutually exclusive answers sequentially', () => {
    const original =
      '选择路线：\n· A. 左 → 向左走。\n· B. 右 → 向右走。\n共同离开。';
    const value = plan();
    value.context = [];
    value.unsupportedRules = [];
    value.scenes = [
      {
        ...value.scenes[0],
        start: 0,
        exit: {
          kind: 'choice',
          prompt: '选择路线',
          choices: [
            { source: { start: 1, end: 1 }, label: '左', nextNodeId: 'left' },
            { source: { start: 2, end: 2 }, label: '右', nextNodeId: 'right' },
          ],
        },
      },
      {
        ...value.scenes[1],
        nodeId: 'left',
        start: 1,
        exit: { kind: 'auto', nextNodeId: 'right' },
      },
      {
        ...value.scenes[1],
        nodeId: 'right',
        start: 2,
        exit: { kind: 'auto', nextNodeId: 'ending' },
      },
      {
        ...value.scenes[1],
        start: 3,
        exit: { kind: 'auto', nextNodeId: null },
      },
    ];
    const blocks = indexStorySource(original);
    expect(
      validateSourceExtraction(value, original, blocks).join('\n'),
    ).toContain('sibling alternative right');
    value.scenes[0].exit = { kind: 'auto', nextNodeId: 'left' };
    expect(
      validateSourceExtraction(value, original, blocks).join('\n'),
    ).toContain('incoming choice or source-backed unresolved route');
  });

  it('rejects chaining distinct endings even when they eventually reach the shared epilogue', () => {
    const original =
      '依据状态决定结局。\n◆结局1：《归乡》\n◆结局2：《远行》\n【片尾·所有结局后统一播放】';
    const value = plan();
    value.context = [];
    value.scenes = [
      {
        ...value.scenes[0],
        start: 0,
        exit: {
          kind: 'unresolved',
          reason: '状态决定结局',
          targetNodeIds: ['first', 'second'],
        },
      },
      {
        ...value.scenes[1],
        nodeId: 'first',
        name: '归乡',
        start: 1,
        exit: { kind: 'auto', nextNodeId: 'second' },
      },
      {
        ...value.scenes[1],
        nodeId: 'second',
        name: '远行',
        start: 2,
        exit: { kind: 'auto', nextNodeId: 'ending' },
      },
      {
        ...value.scenes[1],
        start: 3,
        exit: { kind: 'auto', nextNodeId: null },
      },
    ];
    value.unsupportedRules = [
      {
        source: { start: 0, end: 0 },
        nodeIds: ['opening'],
        affectsRouting: true,
        explanation: '状态尚未实现。',
      },
    ];
    const blocks = indexStorySource(original);
    expect(
      validateSourceExtraction(value, original, blocks).join('\n'),
    ).toContain('reaches a different ending second');
    value.scenes[1].exit = { kind: 'auto', nextNodeId: 'ending' };
    expect(validateSourceExtraction(value, original, blocks)).toEqual([]);
  });

  it('keeps an invalid partial quote available for repair while validation rejects it', () => {
    const value = plan();
    value.scenes[0].exit = {
      kind: 'choice',
      prompt: '如何行动？',
      choices: [
        {
          source: { start: 2, end: 2 },
          label: '不存在的选项',
          nextNodeId: 'ending',
        },
      ],
    };
    const blocks = indexStorySource(source);
    expect(
      validateSourceExtraction(value, source, blocks).join('\n'),
    ).toContain('must uniquely quote');
    expect(
      sourceExtractionAuditView(value, source, blocks).scenes[0].exit,
    ).toMatchObject({
      choices: [{ label: '不存在的选项' }],
    });
  });

  it('retains both outcomes when an inline ending is followed by a conditional continuation', () => {
    const original =
      '若采信假信，触发【结局：伪证之祸】。若识破，继续质问。\n质问后离开。\n【片尾·所有结局后统一播放】';
    const blocks = indexStorySource(original);
    const value = plan();
    value.context = [];
    value.scenes = [
      {
        ...value.scenes[0],
        start: 0,
        name: '伪证之祸',
        exit: { kind: 'auto', nextNodeId: 'epilogue' },
      },
      {
        ...value.scenes[1],
        start: 1,
        exit: { kind: 'auto', nextNodeId: 'epilogue' },
      },
      {
        ...value.scenes[1],
        nodeId: 'epilogue',
        start: 2,
        exit: { kind: 'auto', nextNodeId: null },
      },
    ];
    value.unsupportedRules = [];
    expect(
      validateSourceExtraction(value, original, blocks).join('\n'),
    ).toContain('BOTH shared epilogue');
    value.scenes[0].exit = {
      kind: 'unresolved',
      reason: '鉴别结果',
      targetNodeIds: ['ending', 'epilogue'],
    };
    value.unsupportedRules = [
      {
        source: { start: 0, end: 0 },
        nodeIds: ['opening'],
        affectsRouting: true,
        explanation: '鉴别结果决定失败或继续质问。',
      },
    ];
    expect(validateSourceExtraction(value, original, blocks)).toEqual([]);
  });

  it('keeps the paragraph after an outcome separate even when the model omits its boundary', () => {
    const blocks = indexStorySource(
      '提问\n· 选A → 回应A\n· 选B → 回应B\n官员取出铜符，向所有人说话。',
    );
    const segments = partitionStorySource(
      {
        title: '原稿',
        logline: '原稿',
        synopsis: '原稿',
        characters: [],
        additionalStarts: [],
      },
      blocks,
    );
    expect(segments.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 1 },
      { start: 2, end: 2 },
      { start: 3, end: 3 },
    ]);
  });
  it('keeps menu labels and separators in their owning passage, while retaining nested free-text inputs', () => {
    const text =
      '互动·选择：\n· A. 留下\n· B. 离开\n---\n· B2. 先问问题（输入框）\n· 输入姓名 → 回答';
    const segments = partitionStorySource(
      {
        title: '原稿',
        logline: '原稿',
        synopsis: '原稿',
        characters: [],
        additionalStarts: [0, 1, 2, 3, 4, 5],
      },
      indexStorySource(text),
    );
    expect(segments.map((s) => s.start)).toEqual([0, 4, 5]);
    expect(segments[0].end).toBe(3);
  });

  it('applies routing repairs atomically without changing source identities or metadata', () => {
    const input = plan();
    const before = structuredClone(input);
    const patch = {
      nodeId: 'opening',
      exit: { kind: 'auto' as const, nextNodeId: 'ending' },
      unsupportedRules: [],
    };
    const result = applySourceRoutingRepair(input, { patches: [patch] });
    expect(input).toEqual(before);
    expect(result.scenes[0]).toEqual({ ...before.scenes[0], exit: patch.exit });
    expect(result.scenes[1]).toEqual(before.scenes[1]);
    expect(result.unsupportedRules).toEqual([]);
    expect(() =>
      applySourceRoutingRepair(input, { patches: [patch, patch] }),
    ).toThrow('twice');
    expect(() =>
      applySourceRoutingRepair(input, {
        patches: [{ ...patch, nodeId: 'invented' }],
      }),
    ).toThrow('Unknown repair node');
  });
  it('separates multi-option annotations and their common continuation from the last outcome', () => {
    const blocks = indexStorySource(
      '提问\n· A1. 交出 → 交册\n· A2. 拒绝 → 争执\n（选A2保留残页，选A1获得夜访。）\n官员拿册离开。',
    );
    expect(sourceNarrativeAnchors(blocks)).toEqual([
      { block: 1, kind: 'choice_outcome' },
      { block: 2, kind: 'choice_outcome' },
      { block: 3, kind: 'branch_summary' },
      { block: 4, kind: 'branch_summary' },
    ]);
  });

  it('rejects skipping an explicitly quoted response and fixes literal ending names in the output schema', () => {
    const text =
      '如何行动？\n· A. 留下 → 等待\n· B. 离开 → 【结局：闭门】\n【片尾彩蛋】（所有结局后统一播放）';
    const blocks = indexStorySource(text);
    const segments = [0, 1, 2, 3].map((start) => ({
      nodeId: `source_${start}`,
      start,
      end: start,
    }));
    const value = {
      source_0: {
        name: '选择',
        heading: '门前',
        beat: '选择',
        unsupportedRules: [],
        exit: {
          kind: 'choice' as const,
          prompt: '如何行动？',
          choices: [
            {
              source: { start: 1, end: 1 },
              label: '留下',
              nextNodeId: 'source_3',
            },
          ],
        },
      },
    };
    expect(
      validateSourceBatch(value, [segments[0]], text, blocks, segments).join(
        '\n',
      ),
    ).toContain('must first play its own response source_1');
    value.source_0.exit.choices[0].nextNodeId = 'source_1';
    expect(
      validateSourceBatch(value, [segments[0]], text, blocks, segments),
    ).toEqual([]);
    const ending = {
      name: '闭门',
      heading: '门前',
      beat: '离开',
      exit: { kind: 'auto', nextNodeId: 'source_3' },
      unsupportedRules: [],
    };
    const schema = storySourceBatchSchemaFor([segments[2]], segments, blocks);
    const endingWire = { exit: ending.exit, notes: [] };
    expect(schema.parse({ source_2: endingWire }).source_2.name).toBe('闭门');
    expect(schema.safeParse({ source_2: endingWire }).success).toBe(true);
    const selfLoop = {
      source_2: {
        ...ending,
        exit: { kind: 'auto' as const, nextNodeId: 'source_2' },
      },
    };
    expect(
      schema.safeParse({
        source_2: { ...endingWire, exit: selfLoop.source_2.exit },
      }).success,
    ).toBe(false);
    expect(
      validateSourceBatch(selfLoop, [segments[2]], text, blocks, segments).join(
        '\n',
      ),
    ).toContain('no route out to the shared epilogue source_3');
    expect(
      schema.safeParse({
        source_2: { ...endingWire, exit: value.source_0.exit },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ source_2: { ...endingWire, name: '离开' } }).success,
    ).toBe(false);
  });

  it('rejects an unreachable narrative passage even when it has an incoming cycle', () => {
    const input = plan();
    input.scenes.push({
      ...input.scenes[1],
      nodeId: 'orphan',
      start: 2,
      exit: { kind: 'auto', nextNodeId: 'ending' },
    });
    expect(
      validateSourceExtraction(input, source, indexStorySource(source)).join(
        '\n',
      ),
    ).toContain('orphan at block 2 is unreachable');
    input.scenes[0].exit = {
      kind: 'unresolved',
      reason: '等待原文条件',
      targetNodeIds: ['ending', 'orphan'],
    };
    expect(
      validateSourceExtraction(input, source, indexStorySource(source)),
    ).toEqual([]);
  });
  it('requires an explicit boundary decision for every assigned paragraph', () => {
    const schema = storySourceBoundarySchemaFor([3, 7, 9]);
    expect(
      schema.safeParse({
        block_3: 'continuation',
        block_7: 'branch_rejoin',
        block_9: 'continuation',
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ block_7: 'branch_rejoin' }).success).toBe(false);
    expect(
      schema.safeParse({
        block_3: 'continuation',
        block_7: 'branch_rejoin',
        block_9: 'continuation',
        block_10: 'choice_setup',
      }).success,
    ).toBe(false);
  });
  it('fixes all source boundaries before wiring and rejects missing or invented batch nodes', () => {
    const text = '场景1：选择\n· A. 留下 → 等待\n· B. 离开 → 出门';
    const blocks = indexStorySource(text);
    const partition = {
      title: '原稿',
      logline: '选择',
      synopsis: '选择',
      characters: [],
      additionalStarts: [1, 1],
    };
    const segments = partitionStorySource(partition, blocks);
    expect(segments).toEqual(
      [0, 1, 2].map((start) => ({
        nodeId: `source_${start}`,
        start,
        end: start,
      })),
    );
    const schema = storySourceBatchSchemaFor(segments, segments, blocks);
    const detail = {
      exit: { kind: 'auto', nextNodeId: null },
      notes: [],
    };
    const output = Object.fromEntries(segments.map((s) => [s.nodeId, detail]));
    expect(
      decodeSourceBatch(schema.parse(output), segments).scenes.map(
        (s) => s.start,
      ),
    ).toEqual([0, 1, 2]);
    expect(schema.safeParse({ source_0: detail }).success).toBe(false);
    expect(schema.safeParse({ ...output, source_99: detail }).success).toBe(
      false,
    );
    const provider = z.toJSONSchema(schema, {
      io: 'input',
      target: 'draft-7',
      reused: 'ref',
    });
    expect(provider.required).toEqual(['source_0', 'source_1', 'source_2']);
  });

  it('retains every source block and splits oversized passages without model exclusions', () => {
    const text = '原稿标题\n' + '字'.repeat(5000) + '\n共同对白';
    const blocks = indexStorySource(text);
    const segments = partitionStorySource(
      {
        title: '原稿',
        logline: '原稿',
        synopsis: '原稿',
        characters: [],
        additionalStarts: [],
      },
      blocks,
    );
    expect(
      segments.flatMap((s) =>
        blocks.slice(s.start, s.end + 1).map((b) => b.id),
      ),
    ).toEqual(blocks.map((b) => b.id));
    expect(
      segments.every((s) => sourcePassage(text, blocks, s).length <= 4000),
    ).toBe(true);
    expect(() =>
      partitionStorySource(
        {
          title: '原稿',
          logline: '原稿',
          synopsis: '原稿',
          characters: [],
          additionalStarts: [999],
        },
        blocks,
      ),
    ).toThrow('Invalid source start');
  });

  it('restricts batch destinations to the complete source catalog and validates original choice labels', () => {
    const text = '选择\n· A. 留下 → 等待';
    const blocks = indexStorySource(text);
    const segments = partitionStorySource(
      {
        title: '原稿',
        logline: '原稿',
        synopsis: '原稿',
        characters: [],
        additionalStarts: [],
      },
      blocks,
    );
    const schema = storySourceBatchSchemaFor([segments[0]], segments, blocks);
    const scene = {
      exit: {
        kind: 'choice',
        prompt: '选择',
        choices: [
          {
            source: { start: 1, end: 1 },
            label: '离开',
            nextNodeId: 'source_1',
          },
        ],
      },
      notes: [],
    };
    const output = schema.parse({ source_0: scene });
    expect(
      validateSourceBatch(output, [segments[0]], text, blocks).join('\n'),
    ).toContain('Choice label must uniquely quote');
    expect(
      schema.safeParse({
        source_0: { ...scene, exit: { kind: 'auto', nextNodeId: 'unknown' } },
      }).success,
    ).toBe(false);
  });

  it('copies original action and dialogue into the graph description without adding model headings', () => {
    const blocks = indexStorySource(source);
    const screenplay = assembleSourceScreenplay(
      plan(),
      source,
      blocks,
      'zh-CN',
    );
    const operations = compileScreenplayToStoryOperations(screenplay).map(
      (op) => StoryPatchOperationSchema.parse(op),
    );
    const operation = operations.find(
      (op) => op.kind === 'story_graph.put_node',
    );
    if (operation?.kind !== 'story_graph.put_node')
      throw new Error('Missing node');
    expect(operation.payload.node.description).toBe(
      sourcePassage(source, blocks, { start: 1, end: 3 }),
    );
    expect(operation.payload.node.description).toContain('放射状');
    expect(operation.payload.node.description).toContain('沈千户说');
    expect(screenplay.scenes[0].dialogue).toEqual([]);
  });

  it('preserves conditional destinations and notes without inventing a playable choice', () => {
    const screenplay = assembleSourceScreenplay(
      plan(),
      source,
      indexStorySource(source),
      'zh-CN',
    );
    expect(screenplay.scenes.map((scene) => scene.nodeId)).toEqual([
      'opening',
      'ending',
    ]);
    expect(screenplay.scenes[0].exit).toEqual({
      kind: 'auto',
      nextNodeId: null,
    });
    expect(screenplay.unresolvedNodeIds).toEqual(['opening']);
    expect(screenplay.reviewNotes?.join('\n')).toContain('尚未实现');
    expect(screenplay.reviewNotes?.join('\n')).toContain(
      '信任达到二点才进入结局。',
    );
  });

  it('rejects an executable route whose prerequisite is explicitly unsupported', () => {
    const input = plan();
    input.scenes[0].exit = { kind: 'auto', nextNodeId: 'ending' };
    expect(
      validateSourceExtraction(input, source, indexStorySource(source)).join(
        '\n',
      ),
    ).toContain('unsupported routing rule');
  });

  it('requires a named inline ending to remain independently represented', () => {
    const original = '玩家选择\n信任不足 → 【结局：失约】\n下一场';
    const input = plan();
    input.context = [];
    input.unsupportedRules = [];
    input.scenes[0] = {
      ...input.scenes[0],
      start: 0,
      exit: { kind: 'auto', nextNodeId: null },
    };
    input.scenes[1] = { ...input.scenes[1], start: 2 };
    expect(
      validateSourceExtraction(
        input,
        original,
        indexStorySource(original),
      ).join('\n'),
    ).toContain('Named ending "失约"');
    input.scenes.push({
      ...input.scenes[1],
      nodeId: 'failure',
      name: '失约',
      start: 1,
    });
    input.scenes[0].exit = {
      kind: 'unresolved',
      reason: '信任条件',
      targetNodeIds: ['failure', 'ending'],
    };
    input.unsupportedRules = [
      {
        source: { start: 1, end: 1 },
        nodeIds: ['opening'],
        affectsRouting: true,
        explanation: '信任值判定尚未实现。',
      },
    ];
    expect(
      validateSourceExtraction(input, original, indexStorySource(original)),
    ).toEqual([]);
  });

  it('rejects substituting a different act for a literal branch destination, including unresolved routes', () => {
    const original =
      '【第二幕】\n· B1. 跟随他 → 进入第四幕（安全路线，需信任值达标）\n※ 第三幕·汇合\n【第四幕·地窖】';
    const input = plan();
    input.context = [];
    input.unsupportedRules = [];
    input.scenes = [
      {
        ...input.scenes[0],
        start: 0,
        exit: {
          kind: 'unresolved',
          reason: 'Some actions pending.',
          targetNodeIds: ['wrong'],
        },
      },
      { ...input.scenes[1], nodeId: 'wrong', start: 2 },
      { ...input.scenes[1], start: 3 },
    ];
    expect(
      validateSourceExtraction(
        input,
        original,
        indexStorySource(original),
      ).join('\n'),
    ).toContain('explicitly says "→ 进入第四幕"');
    input.scenes[0].exit = {
      kind: 'unresolved',
      reason: 'Some actions pending.',
      targetNodeIds: ['ending'],
    };
    input.scenes[0].start = 1;
    input.context = [
      { start: 0, reason: 'Act title' },
      { start: 2, reason: 'Annotation' },
    ];
    input.scenes = input.scenes.filter((scene) => scene.nodeId !== 'wrong');
    input.unsupportedRules = [
      {
        source: { start: 1, end: 1 },
        nodeIds: ['opening'],
        affectsRouting: true,
        explanation: '信任条件尚未实现。',
      },
    ];
    expect(
      validateSourceExtraction(input, original, indexStorySource(original)),
    ).toEqual([]);
  });

  it('requires source-backed audit coverage for every node, even when no issues are reported', () => {
    const blocks = indexStorySource(source);
    expect(
      validateSourceAudit({ routes: [], issues: [] }, plan(), source, blocks),
    ).toEqual([
      'Audit route opening -> ending.',
      'Audit route ending -> (end).',
    ]);
    expect(
      validateSourceAudit(
        {
          routes: plan().scenes.map((scene) => ({
            nodeId: scene.nodeId,
            targetNodeId: scene.nodeId === 'opening' ? 'ending' : null,
            source: { start: scene.start, end: scene.start },
            assessment: 'Preserved source route.',
            correct: true,
          })),
          issues: [],
        },
        plan(),
        source,
        blocks,
      ),
    ).toEqual([]);
  });

  it('partitions audit responsibility while retaining cross-scope targets and enforcing full coverage', () => {
    const original = Array.from({ length: 49 }, (_, i) => `Passage ${i}`).join(
      '\n',
    );
    const blocks = indexStorySource(original);
    const input: StorySourceExtraction = {
      ...plan(),
      entrySceneId: 'n0',
      context: [],
      unsupportedRules: [],
      scenes: blocks.map((block) => ({
        nodeId: `n${block.id}`,
        name: block.text,
        heading: block.text,
        beat: block.text,
        start: block.id,
        exit: {
          kind: 'auto',
          nextNodeId: block.id === 48 ? null : `n${block.id + 1}`,
        },
      })),
    };
    const scopes = sourceAuditScopes(input, original, blocks);
    expect(scopes.map((scope) => scope.assigned_scenes.length)).toEqual([
      24, 24, 1,
    ]);
    expect(scopes[0].completeGraph.some((node) => node.nodeId === 'n24')).toBe(
      true,
    );
    const routes = scopes[0].requiredRoutes.map((route) => ({
      ...route,
      source: { start: 0, end: 0 },
      correct: true,
      assessment: 'Original continuation.',
    }));
    expect(
      validateSourceAudit(
        { routes, issues: [] },
        input,
        original,
        blocks,
        scopes[0].requiredRoutes,
      ),
    ).toEqual([]);
    expect(
      validateSourceAudit({ routes, issues: [] }, input, original, blocks),
    ).toContain('Audit route n24 -> n25.');
    expect(
      validateSourceAudit(
        { routes, issues: [] },
        input,
        original,
        blocks,
        scopes[1].requiredRoutes,
      ),
    ).toContain('Unexpected or duplicate audited route n0 -> n1.');
    expect(scopes.flatMap((scope) => scope.requiredRoutes)).toHaveLength(49);
  });

  it('rejects alternate outcomes swallowed by an ending and a shared epilogue hidden in that ending', () => {
    const original =
      '选择道路\n· A. 进门 → 【结局：陷阱】\n· B. 绕行 → 安全离开\n【全剧终·片尾彩蛋】（所有结局后统一播放）\n湖面复归平静。';
    const input = plan();
    input.context = [];
    input.unsupportedRules = [];
    input.scenes = [
      {
        ...input.scenes[0],
        start: 0,
        exit: {
          kind: 'unresolved',
          reason: 'Condition',
          targetNodeIds: ['ending'],
        },
      },
      { ...input.scenes[1], name: '陷阱', start: 1 },
    ];
    const blocks = indexStorySource(original);
    expect(
      sourceNarrativeAnchors(blocks).map((anchor) => anchor.block),
    ).toEqual([1, 2, 3]);
    expect(
      validateSourceExtraction(input, original, blocks).join('\n'),
    ).toContain('Source block 2');
    expect(
      validateSourceExtraction(input, original, blocks).join('\n'),
    ).toContain('Source block 3');
    input.scenes.push(
      {
        ...input.scenes[1],
        nodeId: 'safe',
        name: '绕行',
        start: 2,
        exit: { kind: 'auto', nextNodeId: 'epilogue' },
      },
      { ...input.scenes[1], nodeId: 'epilogue', name: '片尾', start: 3 },
    );
    expect(
      validateSourceExtraction(input, original, blocks).join('\n'),
    ).toContain('needs an incoming');
    expect(
      validateSourceExtraction(input, original, blocks).join('\n'),
    ).toContain('must retain a route to shared epilogue');
    input.scenes[0].exit = {
      kind: 'choice',
      prompt: '选择道路',
      choices: [
        {
          source: { start: 1, end: 1 },
          label: '· A. 进门',
          nextNodeId: 'ending',
        },
        {
          source: { start: 2, end: 2 },
          label: '· B. 绕行',
          nextNodeId: 'safe',
        },
      ],
    };
    input.scenes[1].exit = { kind: 'auto', nextNodeId: 'epilogue' };
    expect(validateSourceExtraction(input, original, blocks)).toEqual([]);
  });

  it('recognizes explicit numbered, unnumbered, and multiline outcomes without treating every bullet as a branch', () => {
    const original =
      '· D2b-1：寻找清流\n· 不动声色收下 → 保留证据\n- 选墨渍 → 蹲下观察\n继续观察纹理。\n· 普通道具列表\n【第四幕·地下】\n场景4-1：地下\n场景4-2：出口';
    expect(
      sourceNarrativeAnchors(indexStorySource(original)).map(
        (anchor) => anchor.block,
      ),
    ).toEqual([0, 1, 2, 3, 5, 7]);
    expect(
      sourceNarrativeAnchors(indexStorySource(original)).find(
        (a) => a.block === 3,
      )?.kind,
    ).toBe('outcome_continuation');
  });

  it('keeps narrative when the model redundantly labels its start as context', () => {
    const input = plan();
    input.context.push({ start: 1, reason: 'Redundant heading marker' });
    const screenplay = assembleSourceScreenplay(
      input,
      source,
      indexStorySource(source),
      'zh-CN',
    );
    expect(screenplay.scenes[0].action).toContain(
      '铜符是圆圈内三条放射状直线。',
    );
    expect(screenplay.scenes[0].action).toContain('信任达到二点才进入结局。');
    expect(input.context).toHaveLength(2);
  });

  it('rejects source dialogue hidden inside a context range', () => {
    const input = plan();
    input.context.push({ start: 2, reason: 'Animation description' });
    expect(
      validateSourceExtraction(input, source, indexStorySource(source)),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Context at block 2 hides narrative block 2'),
      ]),
    );
  });

  it('rejects invalid evidence and duplicate routes without asking the model to copy source prose', () => {
    const blocks = indexStorySource(source);
    const route = {
      nodeId: 'opening',
      targetNodeId: 'ending',
      source: { start: 3, end: 99 },
      assessment: 'Conditional route to the ending.',
      correct: true,
    };
    const issues = validateSourceAudit(
      { routes: [route, route], issues: [] },
      plan(),
      source,
      blocks,
    );
    expect(issues).toContain('Invalid source range 3–99.');
    expect(issues).toContain(
      'Unexpected or duplicate audited route opening -> ending.',
    );
    expect(issues).toContain('Audit route ending -> (end).');
  });

  it('reuses a shared passage with an identical exit and remaps incoming routes and rule references', () => {
    const input = plan();
    input.scenes.push({
      ...input.scenes[1],
      nodeId: 'same-ending',
      name: 'Same scene after a timed branch',
    });
    input.scenes[0].exit = {
      kind: 'unresolved',
      reason: 'Timed branch',
      targetNodeIds: ['same-ending'],
    };
    input.unsupportedRules[0].nodeIds = ['same-ending'];
    input.unsupportedRules[0].affectsRouting = false;
    const normalized = normalizeSourceExtraction(input);
    expect(normalized.scenes).toHaveLength(2);
    expect(normalized.scenes[0].exit).toMatchObject({
      targetNodeIds: ['ending'],
    });
    expect(normalized.unsupportedRules[0].nodeIds).toEqual(['ending']);
    input.scenes[2].exit = { kind: 'auto', nextNodeId: 'opening' };
    expect(
      validateSourceExtraction(input, source, indexStorySource(source)).join(
        '\n',
      ),
    ).toContain('starts more than one');
  });

  it('audits the complete resolved passages, including the last segment and non-narrative context', () => {
    const view = sourceExtractionAuditView(
      plan(),
      source,
      indexStorySource(source),
    );
    expect(view.scenes[0]).toMatchObject({
      source: { start: 1, end: 3 },
      text: '铜符是圆圈内三条放射状直线。\n沈千户说：“查看铜符”。\n信任达到二点才进入结局。',
    });
    expect(view.scenes[1].text).toBe('结局：火种。');
    expect(view.context[0].text).toBe('  原稿标题  ');
  });

  it('rejects missing, overlapping, invented, and overlong source ranges', () => {
    const missing = plan();
    missing.context = [];
    expect(
      validateSourceExtraction(missing, source, indexStorySource(source)).join(
        '\n',
      ),
    ).toContain('first segment must start');
    const overlapping = plan();
    overlapping.scenes[1].start = 1;
    expect(
      validateSourceExtraction(
        overlapping,
        source,
        indexStorySource(source),
      ).join('\n'),
    ).toContain('starts more than one');
    const outside = plan();
    outside.scenes[1].start = 99;
    expect(
      validateSourceExtraction(outside, source, indexStorySource(source)).join(
        '\n',
      ),
    ).toContain('Invalid source range');
    const longSource = '字'.repeat(5000);
    const longPlan = plan();
    longPlan.scenes = [
      {
        ...longPlan.scenes[0],
        start: 0,
        exit: { kind: 'auto', nextNodeId: null },
      },
    ];
    longPlan.context = [];
    longPlan.unsupportedRules = [];
    expect(
      validateSourceExtraction(
        longPlan,
        longSource,
        indexStorySource(longSource),
      ).join('\n'),
    ).toContain('exceeds 4000');
  });

  it('constructs locale maps and copies choice labels from their source blocks', () => {
    const value = plan();
    value.unsupportedRules = [];
    value.scenes[0].exit = {
      kind: 'choice',
      prompt: '如何行动？',
      choices: [
        {
          source: { start: 2, end: 2 },
          label: '查看铜符',
          nextNodeId: 'ending',
        },
      ],
    };
    const screenplay = assembleSourceScreenplay(
      value,
      source,
      indexStorySource(source),
      'zh-CN',
    );
    expect(screenplay.scenes[0].exit).toMatchObject({
      prompt: { 'zh-CN': '如何行动？' },
      choices: [{ label: { 'zh-CN': '查看铜符' } }],
    });
    for (const label of ['"查看铜符"', '「查看铜符」', '『查看铜符』']) {
      value.scenes[0].exit.choices[0].label = label;
      expect(
        assembleSourceScreenplay(
          value,
          source,
          indexStorySource(source),
          'zh-CN',
        ).scenes[0].exit,
      ).toMatchObject({
        choices: [{ label: { 'zh-CN': '“查看铜符”' } }],
      });
    }
    value.scenes[0].exit.choices[0].label = '查看平行线';
    expect(
      validateSourceExtraction(value, source, indexStorySource(source)).join(
        '\n',
      ),
    ).toContain('must uniquely quote its source');
    value.scenes[0].exit.choices[0].source.start = 99;
    expect(
      validateSourceExtraction(value, source, indexStorySource(source)).join(
        '\n',
      ),
    ).toContain('Invalid source range');
  });

  it('preserves source paragraph order and whitespace in the review document', () => {
    expect(
      documentFromStorySource(source).blocks.map((block) => block.text),
    ).toEqual(source.split('\n').filter(Boolean));
  });

  it.each(['· A.', '- 选墨渍'])(
    'uses an explicit source arrow after %s to exclude the answer and ending from a displayed option',
    (prefix) => {
      const original = `${prefix} “查看铜符。” → 回答正确，触发结局。\n结束`;
      const input = plan();
      input.context = [];
      input.unsupportedRules = [];
      input.scenes[0].start = 0;
      input.scenes[1].start = 1;
      input.scenes[0].exit = {
        kind: 'choice',
        prompt: '如何行动？',
        choices: [
          {
            source: { start: 0, end: 0 },
            label: '查看铜符',
            nextNodeId: 'ending',
          },
        ],
      };
      const screenplay = assembleSourceScreenplay(
        input,
        original,
        indexStorySource(original),
        'zh-CN',
      );
      expect(screenplay.scenes[0].exit).toMatchObject({
        choices: [{ label: { 'zh-CN': `${prefix} “查看铜符。”` } }],
      });
      expect(screenplay.scenes[0].action).toContain('回答正确，触发结局。');
      for (const quote of [
        `${prefix} “查看铜符。” →`,
        original.split('\n')[0],
      ]) {
        input.scenes[0].exit.choices[0].label = quote;
        expect(
          assembleSourceScreenplay(
            input,
            original,
            indexStorySource(original),
            'zh-CN',
          ).scenes[0].exit,
        ).toMatchObject({
          choices: [{ label: { 'zh-CN': `${prefix} “查看铜符。”` } }],
        });
      }
    },
  );

  it('splits a long paragraph without splitting a Unicode surrogate pair or losing text', () => {
    const text = '字'.repeat(1999) + '🎬' + '字'.repeat(2100);
    const blocks = indexStorySource(text);
    expect(blocks.map((block) => block.text).join('')).toBe(text);
    expect(blocks.every((block) => !/[\uD800-\uDBFF]$/.test(block.text))).toBe(
      true,
    );
  });

  it('does not take a following option arrow as the end of the preceding option label', () => {
    const original = '· B2. 先问一个问题\n· 输入俞海 → 回答\n结束';
    const input = plan();
    input.context = [];
    input.unsupportedRules = [];
    input.scenes[0].start = 0;
    input.scenes[1].start = 2;
    input.scenes.push({
      nodeId: 'answer',
      name: '回答',
      heading: '回答',
      beat: '回答',
      start: 1,
      exit: { kind: 'auto', nextNodeId: 'ending' },
    });
    input.scenes[0].exit = {
      kind: 'choice',
      prompt: '如何行动？',
      choices: [
        {
          source: { start: 0, end: 1 },
          label: '先问一个问题',
          nextNodeId: 'answer',
        },
      ],
    };
    expect(
      assembleSourceScreenplay(
        input,
        original,
        indexStorySource(original),
        'zh-CN',
      ).scenes[0].exit,
    ).toMatchObject({ choices: [{ label: { 'zh-CN': '先问一个问题' } }] });
  });

  it('locates a unique original option despite a mistaken index and never substitutes the indexed option', () => {
    const original = '· A. 留在这里 → 留下\n· B. 离开 → 出发\n结束';
    const input = plan();
    input.context = [];
    input.unsupportedRules = [];
    input.scenes[0].start = 0;
    input.scenes[1].start = 2;
    input.scenes[0].exit = {
      kind: 'choice',
      prompt: '如何行动？',
      choices: [
        {
          source: { start: 0, end: 0 },
          label: '离开',
          nextNodeId: 'ending',
        },
      ],
    };
    const view = sourceExtractionAuditView(
      input,
      original,
      indexStorySource(original),
    );
    expect(view.scenes[0].exit).toMatchObject({
      choices: [{ source: { start: 1, end: 1 }, label: '· B. 离开' }],
    });
    const ambiguous = original + '\n· C. 离开 → 另一个去处';
    expect(
      validateSourceExtraction(
        input,
        ambiguous,
        indexStorySource(ambiguous),
      ).join('\n'),
    ).toContain('must uniquely quote');
  });
});

describe('linear routing spine', () => {
  type Scene = StorySourceExtraction['scenes'][number];
  const scene = (
    nodeId: string,
    start: number,
    exit: Scene['exit'],
  ): Scene => ({
    nodeId,
    name: nodeId,
    heading: nodeId,
    beat: nodeId,
    start,
    exit,
  });
  const planWith = (scenes: Scene[]): StorySourceExtraction => ({
    title: '标题',
    logline: '一句话梗概。',
    synopsis: '概要。',
    characters: [],
    entrySceneId: 'source_0',
    scenes,
    context: [],
    unsupportedRules: [],
  });

  it('chains plain orphaned scenes along reading order and validates clean', () => {
    const source = '第一段\n第二段\n第三段';
    const blocks = indexStorySource(source);
    const original = planWith([
      scene('source_0', 0, { kind: 'auto', nextNodeId: null }),
      scene('source_1', 1, { kind: 'auto', nextNodeId: null }),
      scene('source_2', 2, { kind: 'auto', nextNodeId: null }),
    ]);
    const spine = applySourceLinearSpine(original, blocks);
    expect(spine.attached).toBe(2);
    expect(spine.plan.scenes.map((item) => item.exit)).toEqual([
      { kind: 'auto', nextNodeId: 'source_1' },
      { kind: 'auto', nextNodeId: 'source_2' },
      { kind: 'auto', nextNodeId: null },
    ]);
    expect(validateSourceExtraction(spine.plan, source, blocks)).toEqual([]);
    // The input plan is never mutated.
    expect(original.scenes[0].exit).toEqual({
      kind: 'auto',
      nextNodeId: null,
    });
  });

  it('leaves choice-outcome orphans for the model loop and routes around them', () => {
    const source = '开场\n· A. 追问 → 继续\n结尾';
    const blocks = indexStorySource(source);
    const original = planWith([
      scene('source_0', 0, { kind: 'auto', nextNodeId: null }),
      scene('source_1', 1, { kind: 'auto', nextNodeId: null }),
      scene('source_2', 2, { kind: 'auto', nextNodeId: null }),
    ]);
    const spine = applySourceLinearSpine(original, blocks);
    // source_1 is an explicit choice outcome: an auto predecessor is not a
    // choice, so only source_2 is attached (to the reachable source_0).
    expect(spine.attached).toBe(1);
    expect(
      spine.plan.scenes.find((item) => item.nodeId === 'source_0')?.exit,
    ).toEqual({ kind: 'auto', nextNodeId: 'source_2' });
    expect(
      spine.plan.scenes.find((item) => item.nodeId === 'source_1')?.exit,
    ).toEqual({ kind: 'auto', nextNodeId: null });
    expect(
      validateSourceExtraction(spine.plan, source, blocks).join('\n'),
    ).toContain('source_1 at block 1 is unreachable');
  });

  it('never routes through ending or shared-epilogue passages', () => {
    const source = '开场\n【结局：火种】\n尾声内容';
    const blocks = indexStorySource(source);
    const original = planWith([
      scene('source_0', 0, { kind: 'auto', nextNodeId: null }),
      scene('ending_1', 1, { kind: 'auto', nextNodeId: null }),
      scene('tail_2', 2, { kind: 'auto', nextNodeId: null }),
    ]);
    const spine = applySourceLinearSpine(original, blocks);
    // ending_1 owns a named ending marker and must not gain a spine edge nor
    // serve as one; tail_2 attaches to source_0 instead.
    expect(spine.attached).toBe(1);
    expect(
      spine.plan.scenes.find((item) => item.nodeId === 'ending_1')?.exit,
    ).toEqual({ kind: 'auto', nextNodeId: null });
    expect(
      spine.plan.scenes.find((item) => item.nodeId === 'source_0')?.exit,
    ).toEqual({ kind: 'auto', nextNodeId: 'tail_2' });
  });

  it('reattaches scenes orphaned by a redirected auto edge to a fixed point', () => {
    const source = '一\n二\n三\n四';
    const blocks = indexStorySource(source);
    const original = planWith([
      scene('source_0', 0, { kind: 'auto', nextNodeId: 'source_3' }),
      scene('source_1', 1, { kind: 'auto', nextNodeId: 'source_2' }),
      scene('source_2', 2, { kind: 'auto', nextNodeId: null }),
      scene('source_3', 3, { kind: 'auto', nextNodeId: null }),
    ]);
    const spine = applySourceLinearSpine(original, blocks);
    expect(spine.attached).toBe(3);
    expect(spine.plan.scenes.map((item) => item.exit)).toEqual([
      { kind: 'auto', nextNodeId: 'source_1' },
      { kind: 'auto', nextNodeId: 'source_2' },
      { kind: 'auto', nextNodeId: 'source_3' },
      { kind: 'auto', nextNodeId: null },
    ]);
    expect(validateSourceExtraction(spine.plan, source, blocks)).toEqual([]);
  });

  it('is a no-op for an already connected plan', () => {
    const source = '第一段\n第二段';
    const blocks = indexStorySource(source);
    const original = planWith([
      scene('source_0', 0, { kind: 'auto', nextNodeId: 'source_1' }),
      scene('source_1', 1, { kind: 'auto', nextNodeId: null }),
    ]);
    const spine = applySourceLinearSpine(original, blocks);
    expect(spine.attached).toBe(0);
    expect(spine.plan).toBe(original);
  });
});

describe('unresolved interactive evidence', () => {
  type Scene = StorySourceExtraction['scenes'][number];
  const scene = (
    nodeId: string,
    start: number,
    exit: Scene['exit'],
  ): Scene => ({
    nodeId,
    name: nodeId,
    heading: nodeId,
    beat: nodeId,
    start,
    exit,
  });
  const planWith = (ruleSource: {
    start: number;
    end: number;
  }): StorySourceExtraction => ({
    title: '标题',
    logline: '一句话梗概。',
    synopsis: '概要。',
    characters: [],
    entrySceneId: 'source_0',
    scenes: [
      scene('source_0', 0, {
        kind: 'unresolved',
        reason: '未实现的交互。',
        targetNodeIds: ['source_1'],
      }),
      scene('source_1', 1, { kind: 'auto', nextNodeId: null }),
    ],
    context: [],
    unsupportedRules: [
      {
        source: ruleSource,
        nodeIds: ['source_0'],
        affectsRouting: true,
        explanation: '未实现的交互。',
      },
    ],
  });

  it('accepts an unresolved rule quoting real interactive notation', () => {
    const source = '开场\n· A. 追问 → 回应';
    expect(
      validateSourceExtraction(
        planWith({ start: 1, end: 1 }),
        source,
        indexStorySource(source),
      ),
    ).toEqual([]);
  });

  it('rejects an unresolved rule quoting a plain chapter hand-off', () => {
    const source = '开场\n要知後事如何，且聽下回分解。\n下回内容';
    const issues = validateSourceExtraction(
      planWith({ start: 1, end: 1 }),
      source,
      indexStorySource(source),
    );
    expect(issues.join('\n')).toContain('contain no interactive notation');
    expect(issues.join('\n')).toContain('ordinary scene transition');
  });
});

describe('unresolved chapter hand-off guard', () => {
  type Scene = StorySourceExtraction['scenes'][number];
  const scene = (
    nodeId: string,
    start: number,
    exit: Scene['exit'],
  ): Scene => ({
    nodeId,
    name: nodeId,
    heading: nodeId,
    beat: nodeId,
    start,
    exit,
  });
  const planWith = (): StorySourceExtraction => ({
    title: '标题',
    logline: '一句话梗概。',
    synopsis: '概要。',
    characters: [],
    entrySceneId: 'source_0',
    scenes: [
      scene('source_0', 0, {
        kind: 'unresolved',
        reason: '未实现的交互。',
        targetNodeIds: ['source_2'],
      }),
      scene('source_2', 2, { kind: 'auto', nextNodeId: null }),
    ],
    context: [],
    unsupportedRules: [
      {
        source: { start: 0, end: 0 },
        nodeIds: ['source_0'],
        affectsRouting: true,
        explanation: '规则引文。',
      },
    ],
  });

  it('rejects an unresolved exit gating the next chapter heading', () => {
    // The rule quotes conditional-sounding prose (若), so it passes the
    // evidence check; the chapter guard must still catch the hand-off.
    const source =
      '若梦初醒，叙事展开。\n要知後事如何，且聽下回分解。\n第二回 新章开始';
    const issues = validateSourceExtraction(
      planWith(),
      source,
      indexStorySource(source),
    );
    expect(issues.join('\n')).toContain('starts the next chapter heading');
  });

  it('keeps the unresolved when the scene itself carries an option arrow', () => {
    const source =
      '若梦初醒，选择追问 → 进入下一章\n要知後事如何，且聽下回分解。\n第二回 新章开始';
    expect(
      validateSourceExtraction(planWith(), source, indexStorySource(source)),
    ).toEqual([]);
  });
});

describe('self-route guard', () => {
  type Scene = StorySourceExtraction['scenes'][number];
  const scene = (
    nodeId: string,
    start: number,
    exit: Scene['exit'],
  ): Scene => ({
    nodeId,
    name: nodeId,
    heading: nodeId,
    beat: nodeId,
    start,
    exit,
  });

  it('rejects an auto exit routing a scene into itself', () => {
    const source = '开场\n后续';
    const issues = validateSourceExtraction(
      {
        title: '标题',
        logline: '一句话梗概。',
        synopsis: '概要。',
        characters: [],
        entrySceneId: 'source_0',
        scenes: [
          scene('source_0', 0, { kind: 'auto', nextNodeId: 'source_0' }),
        ],
        context: [],
        unsupportedRules: [],
      },
      source,
      indexStorySource(source),
    );
    expect(issues.join('\n')).toContain(
      'source_0: a scene cannot route into itself',
    );
  });
});
