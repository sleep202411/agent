import type {
  ExperienceJsonObject,
  ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import { ExperienceRuntimeInvariantError } from "./runtime.js";

export interface ExperienceRendererAdapter {
  rendererId: string;
  apiVersion: string;
  configSchemaVersion: string;
  capabilities: ReadonlySet<string>;
  assertConfig(config: ExperienceJsonObject): void;
  assertCommand(commandType: string, payload: ExperienceJsonObject): void;
  assertOutcome(outcomeType: string, payload: ExperienceJsonObject): void;
}

export class ExperienceRendererRegistry {
  readonly #adapters = new Map<string, ExperienceRendererAdapter>();

  register(adapter: ExperienceRendererAdapter): void {
    if (this.#adapters.has(adapter.rendererId)) {
      throw new ExperienceRuntimeInvariantError(
        "RENDERER_DUPLICATE",
        `Renderer ${adapter.rendererId} is already registered`
      );
    }
    this.#adapters.set(adapter.rendererId, adapter);
  }

  require(rendererId: string): ExperienceRendererAdapter {
    const adapter = this.#adapters.get(rendererId);
    if (!adapter) {
      throw new ExperienceRuntimeInvariantError(
        "RENDERER_UNAVAILABLE",
        `Renderer ${rendererId} is not registered`
      );
    }
    return adapter;
  }

  capabilities(): Set<string> {
    const capabilities = new Set<string>();
    this.#adapters.forEach((adapter) => {
      adapter.capabilities.forEach((capability) => capabilities.add(capability));
    });
    return capabilities;
  }

  assertManifest(manifest: ExperienceRuntimeManifest): void {
    manifest.rendererRequirements.forEach((requirement) => {
      const adapter = this.require(requirement.rendererId);
      if (adapter.apiVersion !== requirement.apiVersion) {
        throw new ExperienceRuntimeInvariantError(
          "RENDERER_API_UNSUPPORTED",
          `Renderer ${requirement.rendererId} requires API ${requirement.apiVersion}; adapter provides ${adapter.apiVersion}`
        );
      }
      if (adapter.configSchemaVersion !== requirement.configSchemaVersion) {
        throw new ExperienceRuntimeInvariantError(
          "RENDERER_CONFIG_SCHEMA_UNSUPPORTED",
          `Renderer ${requirement.rendererId} requires config schema ${requirement.configSchemaVersion}; adapter provides ${adapter.configSchemaVersion}`
        );
      }
      const missing = requirement.requiredCapabilities.filter(
        (capability) => !adapter.capabilities.has(capability)
      );
      if (missing.length > 0) {
        throw new ExperienceRuntimeInvariantError(
          "RENDERER_CAPABILITY_UNSUPPORTED",
          `Renderer ${requirement.rendererId} is missing capabilities: ${missing.join(", ")}`
        );
      }
    });

    manifest.graph.nodes.forEach((node) => {
      if (node.kind !== "scene") return;
      node.renderers.forEach((instance) => {
        this.require(instance.rendererId).assertConfig(instance.config);
      });
    });
  }
}
