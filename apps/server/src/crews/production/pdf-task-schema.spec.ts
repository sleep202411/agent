import { ApplyPdfTasksSchema, groundedPdfTasks } from './pdf-task-schema';
const task = {
  title: 'Design the library',
  description: 'Create the library scene.',
  category: 'scenes',
  evidence: 'The library doors open.',
};
describe('PDF task proposals', () => {
  it('accepts evidence with PDF whitespace normalization', () => {
    expect(
      groundedPdfTasks({ tasks: [task] }, 'The library\n doors open.').tasks,
    ).toHaveLength(1);
  });
  it('rejects hallucinated evidence', () => {
    expect(() =>
      groundedPdfTasks({ tasks: [task] }, 'The castle gates close.'),
    ).toThrow('source excerpt');
  });
  it('rejects duplicated proposals', () => {
    expect(() =>
      groundedPdfTasks({ tasks: [task, task] }, task.evidence),
    ).toThrow('duplicate');
  });
  it('rejects duplicated, empty and invalid selections', () => {
    for (const indices of [[], [0, 0], [-1], [100]])
      expect(ApplyPdfTasksSchema.safeParse({ indices }).success).toBe(false);
    expect(ApplyPdfTasksSchema.safeParse({ indices: [0, 1] }).success).toBe(
      true,
    );
  });
});
