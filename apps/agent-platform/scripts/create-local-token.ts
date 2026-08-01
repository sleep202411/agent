import { SignJWT } from "jose";
import { z } from "zod";

import { localJwtParameters } from "../src/auth/gateway-auth.js";
import {
  agentSessionContextSchema,
  canonicalAgentSessionName,
} from "../src/context/agent-context.js";

const argumentsSchema = z
  .object({
    actorId: z.string().min(1),
    actorDisplayName: z.string().trim().min(1).max(120),
    conversationId: z.uuid(),
    permissionMode: z.enum(["ask", "smart", "full"]).default("smart"),
    surface: z.enum(["story-studio", "crew-management"]),
    workspaceId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    crewId: z.string().min(1).optional(),
    locale: z.string().default("en-US"),
    roles: z.array(z.string()).default([]),
    permissions: z.array(z.string()).default([]),
  })
  .strict();

const secret = z.string().min(32).parse(process.env.AGENT_LOCAL_JWT_SECRET);
const values = argumentsSchema.parse(parseArguments(process.argv.slice(2)));
const scopedContext =
  values.surface === "story-studio"
    ? {
        actorId: values.actorId,
        surface: values.surface,
        scope: {
          kind: "story-project" as const,
          workspaceId: required(values.workspaceId, "--workspaceId", values.surface),
          projectId: required(values.projectId, "--projectId", values.surface),
        },
      }
    : {
        actorId: values.actorId,
        surface: values.surface,
        scope: {
          kind: "crew" as const,
          crewId: required(values.crewId, "--crewId", values.surface),
        },
      };
const context = agentSessionContextSchema.parse({
  ...scopedContext,
  actorDisplayName: values.actorDisplayName,
  conversationId: values.conversationId,
  sessionName: canonicalAgentSessionName(values.conversationId),
  permissionMode: values.permissionMode,
  locale: values.locale,
  roles: values.roles,
  permissions: values.permissions,
  traceId: crypto.randomUUID(),
});
const token = await new SignJWT({ agent_context: context })
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setSubject(context.actorId)
  .setIssuer(localJwtParameters.issuer)
  .setAudience(localJwtParameters.audience)
  .setIssuedAt()
  .setExpirationTime("15m")
  .sign(new TextEncoder().encode(secret));

process.stdout.write(`${token}\n`);

function required(value: string | undefined, flag: string, surface: string): string {
  if (!value) throw new Error(`${flag} is required for ${surface}`);
  return value;
}

function parseArguments(values: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error("Arguments must be provided as --name value pairs");
    }
    const key = flag.slice(2);
    result[key] =
      key === "roles" || key === "permissions" ? value.split(",").filter(Boolean) : value;
  }
  return result;
}
