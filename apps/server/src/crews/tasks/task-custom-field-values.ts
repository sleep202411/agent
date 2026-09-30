import { BadRequestException } from '@nestjs/common';
import { CrewTaskFieldType, Prisma } from '@prisma/client';
import type { CreateCrewTaskInput } from '../dto';

export async function validateTaskCustomFieldValues(
  tx: Prisma.TransactionClient,
  crewId: string,
  taskId: string | null,
  values: CreateCrewTaskInput['customFieldValues'],
): Promise<{
  upserts: Array<{ fieldId: string; value: Prisma.InputJsonValue }>;
  removals: string[];
}> {
  const fieldIds = values.map((item) => item.fieldId);
  if (new Set(fieldIds).size !== fieldIds.length) {
    throw new BadRequestException({
      message: 'Each custom field can only be set once.',
    });
  }
  const fields = await tx.crewTaskFieldDefinition.findMany({
    where: { crewId },
    orderBy: { position: 'asc' },
  });
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const unknownFieldIds = fieldIds.filter((fieldId) => !fieldById.has(fieldId));
  if (unknownFieldIds.length > 0) {
    throw new BadRequestException({
      message: 'Every custom field must belong to this crew.',
      fieldIds: unknownFieldIds,
    });
  }

  const existing = taskId
    ? await tx.crewTaskFieldValue.findMany({
        where: { taskId },
        select: { fieldId: true, value: true },
      })
    : [];
  const effective = new Map(
    existing.map((fieldValue) => [fieldValue.fieldId, fieldValue.value]),
  );
  for (const item of values) {
    if (item.value === null) effective.delete(item.fieldId);
    else effective.set(item.fieldId, item.value);
  }
  const missingRequired = fields
    .filter((field) => field.required && !effective.has(field.id))
    .map((field) => ({ id: field.id, name: field.name }));
  if (missingRequired.length > 0) {
    throw new BadRequestException({
      code: 'CREW_TASK_REQUIRED_FIELDS_MISSING',
      message: 'Complete every required custom field before saving.',
      fields: missingRequired,
    });
  }

  const userIds = new Set<string>();
  const upserts: Array<{
    fieldId: string;
    value: Prisma.InputJsonValue;
  }> = [];
  const removals: string[] = [];
  for (const item of values) {
    const field = fieldById.get(item.fieldId)!;
    if (item.value === null) {
      if (field.required) {
        throw new BadRequestException({
          message: `The required field "${field.name}" cannot be cleared.`,
        });
      }
      removals.push(item.fieldId);
      continue;
    }
    const options = Array.isArray(field.options)
      ? field.options.filter(
          (option): option is { id: string; label: string; color?: string } =>
            typeof option === 'object' &&
            option !== null &&
            !Array.isArray(option) &&
            typeof option.id === 'string' &&
            typeof option.label === 'string',
        )
      : [];
    const optionIds = new Set(options.map((option) => option.id));
    const invalid = (message: string): never => {
      throw new BadRequestException({
        code: 'CREW_TASK_CUSTOM_FIELD_INVALID',
        message: `Invalid value for "${field.name}": ${message}`,
        fieldId: field.id,
      });
    };
    switch (field.type) {
      case CrewTaskFieldType.text:
        if (typeof item.value !== 'string') invalid('expected a text value.');
        if (field.required && !String(item.value).trim())
          invalid('this required field cannot be empty.');
        break;
      case CrewTaskFieldType.number:
        if (typeof item.value !== 'number' || !Number.isFinite(item.value))
          invalid('expected a finite number.');
        break;
      case CrewTaskFieldType.single_select:
        if (typeof item.value !== 'string' || !optionIds.has(item.value))
          invalid('select one available option.');
        break;
      case CrewTaskFieldType.multi_select:
        if (
          !Array.isArray(item.value) ||
          item.value.some(
            (optionId) =>
              typeof optionId !== 'string' || !optionIds.has(optionId),
          ) ||
          new Set(item.value).size !== item.value.length ||
          (field.required && item.value.length === 0)
        )
          invalid('select unique available options.');
        break;
      case CrewTaskFieldType.date:
        if (
          typeof item.value !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(item.value) ||
          Number.isNaN(Date.parse(`${item.value}T00:00:00.000Z`))
        )
          invalid('expected a calendar date.');
        break;
      case CrewTaskFieldType.checkbox:
        if (typeof item.value !== 'boolean')
          invalid('expected a checked or unchecked value.');
        break;
      case CrewTaskFieldType.user:
        if (typeof item.value !== 'string') {
          invalid('select one active crew member.');
        }
        userIds.add(item.value as string);
        break;
    }
    upserts.push({
      fieldId: item.fieldId,
      value: item.value as Prisma.InputJsonValue,
    });
  }
  if (userIds.size > 0) {
    const activeMembers = await tx.crewMember.count({
      where: {
        crewId,
        status: 'active',
        userId: { in: [...userIds] },
      },
    });
    if (activeMembers !== userIds.size) {
      throw new BadRequestException({
        message: 'User fields must reference active crew members.',
      });
    }
  }
  return { upserts, removals };
}
