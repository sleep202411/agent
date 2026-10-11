import { expect, it } from "vitest";
import { gpsMapFeatures, studioMapFeatures } from "./features";
const label = (n: number, matched: boolean) => `${n}:${matched}`;
it("projects official clusters and only resolved selected IP coordinates in the same system", () => {
  const result = {
    mapScope: { coordinateSystem: "WGS84" },
    clusters: [{ cell: "1", matched: true, ipCount: 2, ipId: null, latitude: 1, longitude: 110 }],
    selected: {
      id: "ip",
      title: "Title",
      matched: false,
      locations: [
        {
          id: "a",
          label: "Place",
          status: "resolved",
          point: { coordinateSystem: "WGS84", latitude: 2, longitude: 112 },
        },
        { id: "b", label: "Unresolved", status: "unresolved", point: null },
        {
          id: "c",
          label: "Other system",
          status: "resolved",
          point: { coordinateSystem: "GCJ02", latitude: 2, longitude: 112 },
        },
      ],
    },
  };
  const features = gpsMapFeatures(result as never, label);
  expect(features).toHaveLength(2);
  expect(features[0]).toMatchObject({ count: 2, entityId: null, coordinateSystem: "WGS84" });
  expect(features[1]).toMatchObject({
    label: "Title · Place",
    entityId: "ip",
    matched: false,
    selected: true,
    latitude: 2,
    longitude: 112,
  });
});
it("does not invent private creator pins and avoids duplicating a selected cluster pin", () => {
  const selected = {
    id: "creator",
    name: "Creator",
    matched: false,
    showOnMap: true,
    point: { coordinateSystem: "GCJ02", latitude: 30, longitude: 120 },
  };
  const result = { selected, map: { viewport: { coordinateSystem: "GCJ02" }, clusters: [] } };
  expect(studioMapFeatures(result as never, label)).toMatchObject([
    { selected: true, entityId: "creator", latitude: 30, longitude: 120 },
  ]);
  expect(
    studioMapFeatures({ ...result, selected: { ...selected, showOnMap: false } } as never, label)
  ).toEqual([]);
  expect(studioMapFeatures({ ...result, map: null } as never, label)).toEqual([]);
  const clusters = [
    { cell: "1", matched: false, count: 1, creatorId: "creator", latitude: 30, longitude: 120 },
  ];
  expect(
    studioMapFeatures({ ...result, map: { ...result.map, clusters } } as never, label)
  ).toMatchObject([{ label: "Creator", selected: true }]);
  expect(
    studioMapFeatures({ ...result, map: { ...result.map, clusters } } as never, label)
  ).toHaveLength(1);
});
