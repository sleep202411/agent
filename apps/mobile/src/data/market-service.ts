import {
  getCreatorById,
  getCreatorServices,
  getCreators,
  getCrewFeed,
} from "@/data/browse-service";
import type { CreatorServiceSummary, CreatorSummary, CrewSummary } from "@/data/types";

export type MarketFeed = {
  creators: CreatorSummary[];
  services: CreatorServiceSummary[];
  crews: CrewSummary[];
};

type MarketFeedOptions = {
  creatorLimit?: number;
  serviceLimit?: number;
};

function firstRejected(results: PromiseSettledResult<unknown>[]): Error | undefined {
  const rejected = results.find((result) => result.status === "rejected");
  return rejected?.status === "rejected" && rejected.reason instanceof Error
    ? rejected.reason
    : undefined;
}

export async function getMarketFeed({
  creatorLimit = 18,
  serviceLimit = 20,
}: MarketFeedOptions = {}): Promise<MarketFeed> {
  const [creatorResult, serviceResult, crewResult] = await Promise.allSettled([
    getCreators(creatorLimit),
    getCreatorServices(serviceLimit),
    getCrewFeed(),
  ]);

  const services = serviceResult.status === "fulfilled" ? serviceResult.value : [];
  const crews = crewResult.status === "fulfilled" ? crewResult.value : [];
  let creators = creatorResult.status === "fulfilled" ? creatorResult.value.creators : [];

  // The Java talent-market list can be auth-gated on some deployments. Public
  // creator-service listings still expose creator IDs; hydrate those public
  // profiles so guest marketplace discovery never depends on a protected list.
  if (!creators.length && services.length) {
    const creatorIds = Array.from(new Set(services.map((service) => service.creatorId))).slice(
      0,
      creatorLimit
    );
    const derived = await Promise.allSettled(
      creatorIds.map((creatorId) => getCreatorById(creatorId))
    );
    creators = derived
      .map((result) => (result.status === "fulfilled" ? result.value : undefined))
      .filter((creator): creator is CreatorSummary => !!creator);
  }

  if (!creators.length && !services.length && !crews.length) {
    throw firstRejected([creatorResult, serviceResult, crewResult]) ?? new Error("Market is empty");
  }

  return { creators, services, crews };
}
