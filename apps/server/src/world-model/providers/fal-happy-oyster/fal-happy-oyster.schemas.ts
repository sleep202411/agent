import { z } from 'zod';

export const FalWorldSchema = z
  .object({
    encrypted_world_id: z.string().min(1),
    status: z.enum(['generating', 'ready', 'failed']),
    first_frame: z.url().nullish(),
    name: z.string().nullish(),
    // fal documents `mode` as an optional response field (only the encrypted
    // id and status are required). The adapter supplies the requested mode
    // when normalising the response, while still rejecting an explicit
    // directing-mode response on this adventure-only product path.
    mode: z.literal('adventure').optional(),
    prompt: z.string().optional(),
    creation_model: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    error_code: z.string().nullish(),
    error_message: z.string().nullish(),
  })
  .passthrough();
export type FalWorld = z.infer<typeof FalWorldSchema>;

export const FalConnectionSchema = z
  .object({
    api_base_url: z.url(),
    ticket: z.string().min(1),
    token: z.string().min(1),
    token_expires_in: z.number().positive(),
  })
  .passthrough();

export const FalSessionSchema = z
  .object({
    session_id: z.string().min(1),
    session_timeout_sec: z.number().positive(),
    heartbeat_interval_sec: z.number().positive(),
    connection: FalConnectionSchema,
  })
  .passthrough();

export const FalHeartbeatSchema = z
  .object({
    session_id: z.string().min(1),
    alive: z.boolean(),
    heartbeat_interval_sec: z.number().positive(),
  })
  .passthrough();

export const FalBindTravelSchema = z
  .object({
    session_id: z.string().min(1),
    bound: z.boolean(),
  })
  .passthrough();

export const FalCloseSessionSchema = z
  .object({ session_id: z.string().min(1), closed: z.boolean() })
  .passthrough();

export const FalTokenSchema = z
  .object({
    token: z.string().min(1),
    expires_in: z.number().positive(),
    api_base_url: z.url(),
  })
  .passthrough();

export const FalTravelStatusSchema = z
  .object({
    encrypted_travel_id: z.string().min(1),
    status: z.enum(['init', 'pending', 'running', 'failed', 'completed']),
    rtc_status: z.string().nullish(),
    update_time: z.string().nullish(),
    user_instructions: z.array(z.unknown()).optional(),
    chapters: z.array(z.unknown()).optional(),
    character_actions: z.array(z.string()).optional(),
    environment_actions: z.array(z.string()).optional(),
  })
  .passthrough();

const FalReplayVariantSchema = z
  .object({
    url: z.url(),
    status: z.string(),
    resolution: z.string().nullish(),
  })
  .passthrough();

export const FalTravelArtifactsSchema = z
  .object({
    encrypted_travel_id: z.string().min(1),
    compose_status: z
      .enum(['ready', 'partial', 'processing'])
      .default('processing'),
    video: z.record(z.string(), FalReplayVariantSchema).nullish(),
  })
  .passthrough();
