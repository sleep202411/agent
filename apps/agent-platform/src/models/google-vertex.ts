import { createVertex } from "@ai-sdk/google-vertex";
import { GoogleAuth } from "google-auth-library";

import { ATTACHMENT_URL_PATTERN } from "../attachments/model-attachment-processor.js";
import type { AgentCoreConfig } from "../config/env.js";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

type VertexInferenceConfig = AgentCoreConfig["inference"];
type VertexModel = ReturnType<ReturnType<typeof createVertex>>;
type SupportedUrls = Record<string, RegExp[]>;
type VertexAuthClient = Readonly<{
  getAccessToken: () => Promise<Readonly<{ token?: string | null }>>;
}>;
type VertexAuth = Readonly<{
  getClient: () => Promise<VertexAuthClient>;
}>;

export function createGoogleVertexModels(config: VertexInferenceConfig) {
  const provider = createVertex({
    project: config.project,
    location: config.location,
    googleAuthOptions: {
      projectId: config.project,
      scopes: [CLOUD_PLATFORM_SCOPE],
    },
  });

  return Object.freeze({
    interactive: withAttachmentReferenceSupport(provider(config.interactiveModelId)),
    reasoning: withAttachmentReferenceSupport(provider(config.reasoningModelId)),
    observer: withAttachmentReferenceSupport(provider(config.observerModelId)),
  });
}

/**
 * Declares the FizzDragon attachment URI as a URL this model consumes without a
 * prompt-time download. Mastra builds the provider prompt — and fetches every
 * file part whose data parses as a URL — before input processors run, so an
 * undeclared scheme turns a product reference into an unknown-scheme fetch that
 * fails the whole turn. ModelAttachmentProcessor still replaces every reference
 * before the provider call, so the raw URI never leaves the runtime.
 */
function withAttachmentReferenceSupport(model: VertexModel): VertexModel {
  return new Proxy(model, {
    get(target, property, receiver) {
      if (property !== "supportedUrls") return Reflect.get(target, property, receiver);
      const declared = target.supportedUrls;
      return isPromiseLike(declared)
        ? declared.then(withAttachmentReferences)
        : withAttachmentReferences(declared);
    },
  });
}

function withAttachmentReferences(supportedUrls: SupportedUrls): SupportedUrls {
  return {
    ...supportedUrls,
    "*": [...(supportedUrls["*"] ?? []), ATTACHMENT_URL_PATTERN],
  };
}

function isPromiseLike(
  value: PromiseLike<SupportedUrls> | SupportedUrls
): value is PromiseLike<SupportedUrls> {
  return typeof (value as PromiseLike<SupportedUrls>).then === "function";
}

export async function assertGoogleVertexAuthenticationReady(
  config: VertexInferenceConfig,
  authOverride?: VertexAuth
): Promise<void> {
  const auth: VertexAuth =
    authOverride ??
    new GoogleAuth({
      projectId: config.project,
      scopes: [CLOUD_PLATFORM_SCOPE],
    });

  try {
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    if (!accessToken.token) {
      throw new Error("ADC returned no access token");
    }
  } catch {
    throw new Error(
      `Google Vertex ADC authentication failed for project ${config.project}; ` +
        "configure Application Default Credentials before starting the Worker"
    );
  }
}
