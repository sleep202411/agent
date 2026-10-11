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
