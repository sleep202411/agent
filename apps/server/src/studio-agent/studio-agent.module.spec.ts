import { StudioAgentArtifactController } from './studio-agent-artifact.controller';
import { StudioAgentArtifactCleanupWorker } from './studio-agent-artifact-cleanup.service';
import { StudioAgentRuntimeController } from './studio-agent-runtime.controller';
import { StudioAgentController } from './studio-agent.controller';
import { StudioAgentCommandOutboxDispatcher } from './studio-agent.outbox';
import { StudioAgentModule } from './studio-agent.module';
import { StudioAgentTemporalTransport } from './studio-agent.temporal';

describe('StudioAgentModule', () => {
  it('registers the complete HTTP and worker boundary', () => {
    const definition = StudioAgentModule.register();

    expect(definition.controllers).toEqual(
      expect.arrayContaining([
        StudioAgentController,
        StudioAgentArtifactController,
        StudioAgentRuntimeController,
      ]),
    );
    expect(definition.providers).toEqual(
      expect.arrayContaining([
        StudioAgentTemporalTransport,
        StudioAgentCommandOutboxDispatcher,
        StudioAgentArtifactCleanupWorker,
      ]),
    );
    expect(new Set(definition.providers).size).toBe(
      definition.providers?.length,
    );
  });

  it('registers every studio-agent provider its providers inject', () => {
    const definition = StudioAgentModule.register();
    const providers = (definition.providers ?? []) as Array<
      new (...args: never[]) => unknown
    >;
    const registered = new Set(providers);

    // Constructor deps whose type name starts with `StudioAgent` are always
    // local providers (external deps — Prisma, Quota, Storage, Entitlement,
    // Story* — never carry that prefix), so each must be in the array or Nest
    // throws UnknownDependenciesException at boot.
    for (const provider of providers) {
      const deps = (Reflect.getMetadata('design:paramtypes', provider) ??
        []) as unknown[];
      for (const dep of deps) {
        if (
          typeof dep === 'function' &&
          dep.name.startsWith('StudioAgent') &&
          !registered.has(dep as new (...args: never[]) => unknown)
        ) {
          throw new Error(
            `${provider.name} injects ${dep.name}, which is not in STUDIO_AGENT_PROVIDERS`,
          );
        }
      }
    }
  });
});
