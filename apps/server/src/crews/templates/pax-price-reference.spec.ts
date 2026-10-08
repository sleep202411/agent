import { DEFAULT_SERIES_TASK_TEMPLATE } from './project-task-template.types';
import { TaskTemplateDefinitionSchema } from './project-task-template.schema';
describe('2026-10-08 Pax workbook reference defaults', () => {
  const get = (key: string) =>
    DEFAULT_SERIES_TASK_TEMPLATE.items.find((x) => x.templateKey === key)!;
  it('uses 1,000-word script pricing and a 10 percent director reference', () => {
    expect(get('script')).toMatchObject({
      unit: '1000字',
      priceRange: { min: 150, max: 300 },
    });
    expect(get('director')).toMatchObject({
      qualification: { fdRank: 2 },
      priceRange: { min: 10, unit: 'percent' },
    });
  });
  it('keeps FD1 base assembly per item distinct from FD2/FD3 per-minute work', () => {
    expect(get('assembly_base')).toMatchObject({
      unit: '条',
      priceRange: { min: 8 },
      qualification: { fdRank: 1 },
    });
    expect(get('assembly_fine_cut')).toMatchObject({
      unit: '分钟',
      priceRange: { min: 120 },
      qualification: { fdRank: 2 },
    });
    expect(get('assembly_standalone')).toMatchObject({
      unit: '分钟',
      priceRange: { min: 150 },
      qualification: { fdRank: 3 },
      deliveryFields: [{ type: 'final_video', required: true }],
    });
    expect(() =>
      TaskTemplateDefinitionSchema.parse(DEFAULT_SERIES_TASK_TEMPLATE),
    ).not.toThrow();
  });
  it('rejects invalid FD ranks', () => {
    const item = { ...get('script'), qualification: { fdRank: 6 } };
    expect(() =>
      TaskTemplateDefinitionSchema.parse({ version: 1, items: [item] }),
    ).toThrow();
  });
});
