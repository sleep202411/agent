import {
  ProfessionalDeliveryInput,
  validateProfessionalDelivery,
} from './task-delivery-template';
const id = '00000000-0000-4000-8000-000000000001',
  asset = '00000000-0000-4000-8000-000000000002';
const template = {
  categoryId: id,
  version: 1,
  definition: {
    name: 'Task',
    description: '',
    status: 'active' as const,
    prices: [],
    fields: [
      {
        key: 'file',
        label: 'File',
        instructions: '',
        type: 'attachment' as const,
        required: true,
      },
    ],
  },
};
const input = { categoryId: id, version: 1, answers: { file: [asset] } };
it('requires the pinned version and attachment membership, without accepting arbitrary references', () => {
  expect(validateProfessionalDelivery(template, input, [asset])).toMatchObject(
    input,
  );
  expect(() => validateProfessionalDelivery(template, input, [])).toThrow(
    'attachments',
  );
  expect(() =>
    validateProfessionalDelivery(template, { ...input, version: 2 }, [asset]),
  ).toThrow('template');
  expect(() =>
    validateProfessionalDelivery(
      template,
      { ...input, answers: { file: [] } },
      [asset],
    ),
  ).toThrow('attachments');
  expect(() =>
    validateProfessionalDelivery(
      template,
      { ...input, answers: { file: [asset, asset] } },
      [asset],
    ),
  ).toThrow('attachments');
  expect(() =>
    validateProfessionalDelivery(
      template,
      { ...input, answers: { unexpected: 'value' } },
      [asset],
    ),
  ).toThrow('Unknown');
  expect(() => validateProfessionalDelivery(null, input, [asset])).toThrow(
    'no professional',
  );
  expect(validateProfessionalDelivery(null, undefined, [])).toBeNull();
  expect(
    ProfessionalDeliveryInput.safeParse({
      ...input,
      answers: { file: ['not-uuid'] },
    }).success,
  ).toBe(false);
});
