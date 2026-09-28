import { CreateServiceSchema, UpdateServiceSchema } from './dto';

it('title-only PATCH leaves omitted fields absent', () => {
  expect(UpdateServiceSchema.parse({ title: ' Renamed ' })).toEqual({
    title: 'Renamed',
  });
});
it('explicit empty cover/tags remain explicit', () => {
  expect(UpdateServiceSchema.parse({ coverPath: '', tags: [] })).toEqual({
    coverPath: '',
    tags: [],
  });
});
it('create supplies draft defaults without applying them to PATCH', () => {
  expect(
    CreateServiceSchema.parse({
      title: 'Service',
      summary: 'Summary',
      category: 'other',
    }),
  ).toMatchObject({
    coverPath: '',
    tags: [],
    packages: [],
    requirementQuestions: [],
  });
  expect(UpdateServiceSchema.parse({})).toEqual({});
});
