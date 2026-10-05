import type { CreatorDiscoveryResult } from "@repo/shared/creator-location";
import type { GpsMapFeature } from "../../ips/_data/content-gps-map-types";
export function studioMapFeatures(
  result: CreatorDiscoveryResult,
  label: (count: number, matched: boolean) => string,
  islandLabel?: string
): GpsMapFeature[] {
  if (!result.map) return [];
  const selected = result.selected;
  const coordinateSystem = result.map.viewport.coordinateSystem;
  const features: GpsMapFeature[] = result.map.clusters.map((cluster) => ({
    id: `creator:${cluster.cell}:${cluster.matched}`,
    latitude: cluster.latitude,
    longitude: cluster.longitude,
    coordinateSystem,
    label:
      cluster.creatorId === selected?.id ? selected.name : label(cluster.count, cluster.matched),
    matched: cluster.matched,
    selected: cluster.creatorId !== null && cluster.creatorId === selected?.id,
    count: cluster.count,
    entityId: cluster.creatorId,
  }));
  if (
    selected?.showOnMap &&
    selected.point?.coordinateSystem === coordinateSystem &&
    !features.some((feature) => feature.entityId === selected.id)
  )
    features.push({
      id: `creator:selected:${selected.id}`,
      latitude: selected.point.latitude,
      longitude: selected.point.longitude,
      coordinateSystem,
      label: selected.name,
      matched: selected.matched,
      selected: true,
      count: 1,
      entityId: selected.id,
    });
  if (islandLabel)
    features.push({
      id: "virtual:fizzdragon-island",
      // Fictional visual anchor in the South Pacific. Never persisted on a creator,
      // included in server geographic counts, or presented as a geocoded location.
      latitude: -25,
      longitude: -140,
      coordinateSystem,
      label: islandLabel,
      matched: false,
      selected: false,
      count: result.island.matchedCreatorCount,
      entityId: null,
      virtualDestination: "fizzdragon-island",
    });
  return features;
}
