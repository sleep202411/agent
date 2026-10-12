import {
  documentTaskSources,
  resolveDocumentTasks,
} from './document-task-sources';

const task = {
  title: 'Prepare scene',
  description: 'Prepare the described location.',
  category: 'scenes',
  sourceId: 0,
};
const normalize = (s: string) =>
  s.normalize('NFKC').replace(/\s+/g, ' ').trim();
it.each([
  '城门缓缓打开。\n将军踏入城中，风雪漫天。',
  '场'.repeat(1601),
  '场'.repeat(800) + '\n'.repeat(1200) + '终',
  'A long screenplay passage.\n'.repeat(2400),
])(
  'resolves bounded server-owned excerpts without requiring copied AI quotations',
  (source) => {
    const passages = documentTaskSources(source);
    expect(passages.length).toBeGreaterThan(0);
    for (const [sourceId, evidence] of passages.entries()) {
      expect(evidence.length).toBeGreaterThanOrEqual(8);
      expect(evidence.length).toBeLessThanOrEqual(1000);
      expect(normalize(source)).toContain(normalize(evidence));
      expect(
        resolveDocumentTasks(
          { tasks: [{ ...task, sourceId }] },
          source,
          passages,
        ).tasks[0].evidence,
      ).toBe(evidence);
    }
    expect(passages.at(-1)?.endsWith(normalize(source).slice(-1))).toBe(true);
  },
);
it.each([-1, 99, 0.5, '0', null])(
  'rejects invalid source IDs (%s)',
  (sourceId) => {
    const source = 'The library doors open.';
    expect(() =>
      resolveDocumentTasks(
        { tasks: [{ ...task, sourceId }] },
        source,
        documentTaskSources(source),
      ),
    ).toThrow();
  },
);
it('rejects model-supplied evidence instead of trusting it', () => {
  const source = 'The library doors open.';
  expect(() =>
    resolveDocumentTasks(
      { tasks: [{ ...task, evidence: 'invented' }] },
      source,
      documentTaskSources(source),
    ),
  ).toThrow();
});
it('rejects sources too short to ground a task', () => {
  expect(() => documentTaskSources('short')).toThrow('too short');
});

it('splits at episode headings and derives episode titles from the source', () => {
  const source =
    '第一季·第三集 风雪中前行（时长4分钟）\n雪地里觉如举起石牌。\n第一季·第四集 黎明\n觉如走进王城。';
  const passages = documentTaskSources(source);
  expect(passages).toHaveLength(2);
  const result = resolveDocumentTasks(
    {
      tasks: [
        { ...task, title: '石牌', category: 'props', sourceId: 0 },
        { ...task, title: '觉如', category: 'characters', sourceId: 0 },
        { ...task, title: '王城', category: 'scenes', sourceId: 1 },
      ],
    },
    source,
    passages,
  );
  expect(result.tasks[0]).toMatchObject({
    title: '第三集-石牌',
    episode: { number: 3, title: '风雪中前行', label: '第三集' },
  });
  expect(result.tasks[1].title).toBe('觉如');
  expect(result.tasks[1].episode).toBeUndefined();
  expect(result.tasks[2]).toMatchObject({
    title: '第四集-王城',
    episode: { number: 4 },
  });
});
it('recognizes English episode headings without treating dialogue mentions as headings', () => {
  const source =
    'Episode 12: Snow\nThe guard mentions Episode 15 in his speech.';
  const result = resolveDocumentTasks(
    { tasks: [{ ...task, title: 'Snow' }] },
    source,
    documentTaskSources(source),
  );
  expect(result.tasks[0]).toMatchObject({
    title: 'Episode 12-Snow',
    episode: { number: 12, title: 'Snow' },
  });
});
it('does not accept an AI invented episode field', () => {
  const source = 'The library doors open.';
  expect(() =>
    resolveDocumentTasks(
      {
        tasks: [
          {
            ...task,
            episode: { number: 99, title: 'Invented', label: 'Episode 99' },
          },
        ],
      },
      source,
      documentTaskSources(source),
    ),
  ).toThrow();
});

it.each([
  '第三集-风雪',
  '第三集《风雪》',
  '第三集（风雪）',
  '第三集 (风雪)',
  '第三集《风雪》（时长4分钟）',
])('preserves episode identity for bracketed heading %s', (heading) => {
  const source = `${heading}\n雪地里觉如举起石牌。\n第四集 黎明\n觉如走进王城。`;
  const result = resolveDocumentTasks(
    { tasks: [{ ...task, title: '石牌', category: 'props', sourceId: 0 }] },
    source,
    documentTaskSources(source),
  );
  expect(result.tasks[0]).toMatchObject({
    title: '第三集-石牌',
    episode: { number: 3, title: '风雪', label: '第三集' },
  });
  expect(documentTaskSources(source)).toHaveLength(2);
});
