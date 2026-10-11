import { z } from "zod";
import {
  BindWorldTravelRequestSchema,
  BoundWorldTravelSchema,
  CloseWorldSessionRequestSchema,
  CreateWorldSessionRequestSchema,
  RefreshWorldSessionTokenRequestSchema,
  RefreshWorldSessionTokenResponseSchema,
  ReportWorldTravelStatusRequestSchema,
  WorldSessionHeartbeatSchema,
  WorldSessionSchema,
  WorldTravelStatusResponseSchema,
  type BindWorldTravelRequest,
  type CloseWorldSessionRequest,
  type CreateWorldSessionRequest,
  type RefreshWorldSessionTokenRequest,
  type ReportWorldTravelStatusRequest,
} from "@repo/shared/world-model-protocol";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";

export interface WorldTravelScope {
  workspaceId: string;
  projectId: string;
  worldId: string;
  generation: number;
}

/** One client per world playback. Never read a mutable selected workspace. */
export function createWorldTravelApi(input: WorldTravelScope) {
  const scope = Object.freeze({ ...input });
  const uuid = z.string().uuid();
  uuid.parse(scope.workspaceId);
  uuid.parse(scope.projectId);
  uuid.parse(scope.worldId);
  const base = `/story-projects/${scope.projectId}/world-model`;
  const current = () => {
    if (scope.generation !== getAuthGeneration())
      throw new Error("World playback session expired. Sign in again before continuing.");
  };
  async function post<T>(path: string, data: unknown, schema: { parse(value: unknown): T }) {
    current();
    const response = await api.post<unknown>(`${base}${path}`, {
      service: "aurora",
      headers: { "X-Fizz-Workspace-Id": scope.workspaceId },
      data,
      // Session creation has no server idempotency key; do not resubmit a
      // request whose response was lost. The server expires abandoned leases.
      retry: false,
    });
    current();
    return schema.parse(response);
  }
  const sessionPath = (id: string) => `/sessions/${uuid.parse(id)}`;
  return {
    async createWorldSession(input: CreateWorldSessionRequest) {
      const session = await post(
        `/worlds/${scope.worldId}/sessions`,
        CreateWorldSessionRequestSchema.parse(input),
        WorldSessionSchema
      );
      if (session.worldId !== scope.worldId) throw new Error("World session scope mismatch.");
      return session;
    },
    async bindWorldTravel(sessionId: string, input: BindWorldTravelRequest) {
      const travel = await post(
        `${sessionPath(sessionId)}/bind-travel`,
        BindWorldTravelRequestSchema.parse(input),
        BoundWorldTravelSchema
      );
      if (travel.sessionId !== sessionId || travel.worldId !== scope.worldId)
        throw new Error("World travel scope mismatch.");
      return travel;
    },
    heartbeatWorldSession(sessionId: string) {
      return post(`${sessionPath(sessionId)}/heartbeat`, undefined, WorldSessionHeartbeatSchema);
    },
    refreshWorldSessionToken(sessionId: string, input: RefreshWorldSessionTokenRequest) {
      return post(
        `${sessionPath(sessionId)}/token`,
        RefreshWorldSessionTokenRequestSchema.parse(input),
        RefreshWorldSessionTokenResponseSchema
      );
    },
    async closeWorldSession(sessionId: string, input: CloseWorldSessionRequest) {
      const result = await post(
        `${sessionPath(sessionId)}/close`,
        CloseWorldSessionRequestSchema.parse(input),
        z.object({ closed: z.boolean() })
      );
      if (!result.closed) throw new Error("The world session did not close. Retry cleanup.");
      return result;
    },
    async reportWorldTravelStatus(travelId: string, input: ReportWorldTravelStatusRequest) {
      const travel = await post(
        `/travels/${uuid.parse(travelId)}/status`,
        ReportWorldTravelStatusRequestSchema.parse(input),
        WorldTravelStatusResponseSchema
      );
      if (travel.id !== travelId || travel.worldId !== scope.worldId)
        throw new Error("World travel status scope mismatch.");
      return travel;
    },
  };
}

export type WorldTravelApi = ReturnType<typeof createWorldTravelApi>;
