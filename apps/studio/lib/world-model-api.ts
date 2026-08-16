import {
  BindWorldTravelRequestSchema,
  BoundWorldTravelSchema,
  CloseWorldSessionRequestSchema,
  CreateWorldRequestSchema,
  CreateWorldSessionRequestSchema,
  RefreshWorldSessionTokenRequestSchema,
  RefreshWorldSessionTokenResponseSchema,
  ReportWorldTravelStatusRequestSchema,
  WorldModelCapabilitiesSchema,
  WorldModelWorldSchema,
  WorldSessionHeartbeatSchema,
  WorldSessionSchema,
  WorldTravelArtifactsSchema,
  WorldTravelStatusResponseSchema,
  type BindWorldTravelRequest,
  type BoundWorldTravel,
  type CloseWorldSessionRequest,
  type CreateWorldRequest,
  type CreateWorldSessionRequest,
  type RefreshWorldSessionTokenRequest,
  type RefreshWorldSessionTokenResponse,
  type ReportWorldTravelStatusRequest,
  type WorldModelCapabilities,
  type WorldModelWorld,
  type WorldSession,
  type WorldSessionHeartbeat,
  type WorldTravelArtifacts,
  type WorldTravelStatusResponse,
} from "@repo/shared/world-model-protocol";
import { api } from "@/lib/api";

interface Parser<T> {
  parse(value: unknown): T;
}

function arrayParser<T>(item: Parser<T>): Parser<T[]> {
  return {
    parse(value) {
      if (!Array.isArray(value)) throw new TypeError("Expected an array response.");
      return value.map((entry) => item.parse(entry));
    },
  };
}

const WorldModelCapabilitiesListSchema = arrayParser(WorldModelCapabilitiesSchema);
const WorldModelWorldListSchema = arrayParser(WorldModelWorldSchema);
const CloseWorldSessionResponseSchema: Parser<{ closed: boolean }> = {
  parse(value) {
    if (
      typeof value !== "object" ||
      value === null ||
      !("closed" in value) ||
      typeof value.closed !== "boolean"
    ) {
      throw new TypeError("Expected a world session close response.");
    }
    return { closed: value.closed };
  },
};

function basePath(projectId: string) {
  return `/aurora/story-projects/${encodeURIComponent(projectId)}/world-model`;
}

export const worldModelQueryKeys = {
  providers: (projectId: string) => ["story-world-model", "providers", projectId] as const,
  worlds: (projectId: string) => ["story-world-model", "worlds", projectId] as const,
  world: (projectId: string, worldId: string) =>
    ["story-world-model", "world", projectId, worldId] as const,
};

async function readValidated<T>(promise: Promise<unknown>, schema: Parser<T>): Promise<T> {
  return schema.parse(await promise);
}

export function listWorldModelProviders(projectId: string): Promise<WorldModelCapabilities[]> {
  return readValidated(
    api.get(`${basePath(projectId)}/providers`),
    WorldModelCapabilitiesListSchema
  );
}

export function listWorlds(projectId: string): Promise<WorldModelWorld[]> {
  return readValidated(api.get(`${basePath(projectId)}/worlds`), WorldModelWorldListSchema);
}

export function createWorld(
  projectId: string,
  input: CreateWorldRequest,
  idempotencyKey: string
): Promise<WorldModelWorld> {
  const data = CreateWorldRequestSchema.parse(input);
  if (!idempotencyKey.trim()) throw new Error("World creation requires an idempotency key.");
  return readValidated(
    api.post(`${basePath(projectId)}/worlds`, {
      data,
      headers: { "Idempotency-Key": idempotencyKey },
    }),
    WorldModelWorldSchema
  );
}

export function getWorld(projectId: string, worldId: string): Promise<WorldModelWorld> {
  return readValidated(
    api.get(`${basePath(projectId)}/worlds/${encodeURIComponent(worldId)}`),
    WorldModelWorldSchema
  );
}

export function createWorldSession(
  projectId: string,
  worldId: string,
  input: CreateWorldSessionRequest
): Promise<WorldSession> {
  const data = CreateWorldSessionRequestSchema.parse(input);
  return readValidated(
    api.post(`${basePath(projectId)}/worlds/${encodeURIComponent(worldId)}/sessions`, { data }),
    WorldSessionSchema
  );
}

export function heartbeatWorldSession(
  projectId: string,
  sessionId: string
): Promise<WorldSessionHeartbeat> {
  return readValidated(
    api.post(`${basePath(projectId)}/sessions/${encodeURIComponent(sessionId)}/heartbeat`),
    WorldSessionHeartbeatSchema
  );
}

export function bindWorldTravel(
  projectId: string,
  sessionId: string,
  input: BindWorldTravelRequest
): Promise<BoundWorldTravel> {
  const data = BindWorldTravelRequestSchema.parse(input);
  return readValidated(
    api.post(`${basePath(projectId)}/sessions/${encodeURIComponent(sessionId)}/bind-travel`, {
      data,
    }),
    BoundWorldTravelSchema
  );
}

export function refreshWorldSessionToken(
  projectId: string,
  sessionId: string,
  input: RefreshWorldSessionTokenRequest
): Promise<RefreshWorldSessionTokenResponse> {
  const data = RefreshWorldSessionTokenRequestSchema.parse(input);
  return readValidated(
    api.post(`${basePath(projectId)}/sessions/${encodeURIComponent(sessionId)}/token`, { data }),
    RefreshWorldSessionTokenResponseSchema
  );
}

export async function closeWorldSession(
  projectId: string,
  sessionId: string,
  input: CloseWorldSessionRequest
): Promise<{ closed: boolean }> {
  const data = CloseWorldSessionRequestSchema.parse(input);
  return readValidated(
    api.post(`${basePath(projectId)}/sessions/${encodeURIComponent(sessionId)}/close`, { data }),
    CloseWorldSessionResponseSchema
  );
}

export function reportWorldTravelStatus(
  projectId: string,
  travelId: string,
  input: ReportWorldTravelStatusRequest
): Promise<WorldTravelStatusResponse> {
  const data = ReportWorldTravelStatusRequestSchema.parse(input);
  return readValidated(
    api.post(`${basePath(projectId)}/travels/${encodeURIComponent(travelId)}/status`, { data }),
    WorldTravelStatusResponseSchema
  );
}

export function getWorldTravelArtifacts(
  projectId: string,
  travelId: string
): Promise<WorldTravelArtifacts> {
  return readValidated(
    api.get(`${basePath(projectId)}/travels/${encodeURIComponent(travelId)}/artifacts`),
    WorldTravelArtifactsSchema
  );
}
