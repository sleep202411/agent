export const assistantEntityTypes = [
  'project',
  'episode',
  'character',
  'scene',
  'prop',
  'shot_value',
  'storyboard',
] as const;

export type AssistantEntityType = (typeof assistantEntityTypes)[number];

export const assistantMutationActions = [
  'project.updated',
  'episode.created',
  'episode.batch_created',
  'episode.updated',
  'episode.deleted',
  'character.created',
  'character.updated',
  'character.deleted',
  'character.batch_created',
  'scene.created',
  'scene.updated',
  'scene.deleted',
  'scene.batch_created',
  'prop.created',
  'prop.updated',
  'prop.deleted',
  'prop.batch_created',
  'storyboard.cell_filled',
  'storyboard.saved',
  'storyboard.pipeline_applied',
] as const;

export type AssistantMutationAction = (typeof assistantMutationActions)[number];

export interface AssistantMutationResult {
  success: boolean;
  action: AssistantMutationAction;
  message: string;
  entityId?: string;
  entityType?: AssistantEntityType;
  count?: number;
  entityIds?: string[];
}
