export const AI_ACTOR_CATEGORIES = [
  'ai_actor',
  'influencer',
  'real_actor',
  'other',
] as const;

export type AiActorCategory = (typeof AI_ACTOR_CATEGORIES)[number];
