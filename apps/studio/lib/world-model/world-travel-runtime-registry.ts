import { FAL_HAPPY_OYSTER_PROVIDER_KEY } from "@repo/shared/world-model-protocol";
import { createHappyOysterRuntime } from "./happy-oyster-runtime";
import type {
  CreateWorldTravelRuntimeInput,
  WorldTravelRuntime,
  WorldTravelRuntimeFactory,
} from "./world-travel-runtime";

const factories = new Map<string, WorldTravelRuntimeFactory>([
  [FAL_HAPPY_OYSTER_PROVIDER_KEY, createHappyOysterRuntime],
]);

export function createWorldTravelRuntime(
  input: CreateWorldTravelRuntimeInput
): Promise<WorldTravelRuntime> {
  const factory = factories.get(input.providerKey);
  if (!factory) throw new Error(`Unsupported world model provider: ${input.providerKey}`);
  return factory(input);
}
