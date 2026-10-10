import { gpsLocationsSchema, type GpsLocation, type GpsSuggestions } from "./content-gps-api";
export type GpsDraft = {
  id: string;
  kind: GpsLocation["kind"];
  label: string;
  status: GpsLocation["status"];
  latitude: string;
  longitude: string;
  coordinateSystem: "WGS84" | "GCJ02";
  precision: "country" | "region" | "city" | "place";
};
export function gpsDrafts(rows: GpsLocation[]): GpsDraft[] {
  return rows.map((row) => ({
    ...row,
    latitude: row.point ? String(row.point.latitude) : "",
    longitude: row.point ? String(row.point.longitude) : "",
    coordinateSystem: row.point?.coordinateSystem ?? "WGS84",
    precision: row.point?.precision ?? "city",
  }));
}
export function parseGpsDrafts(rows: GpsDraft[]) {
  return gpsLocationsSchema.safeParse(
    rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      status: row.status,
      point:
        row.status === "resolved"
          ? {
              latitude: row.latitude.trim() ? Number(row.latitude) : NaN,
              longitude: row.longitude.trim() ? Number(row.longitude) : NaN,
              coordinateSystem: row.coordinateSystem,
              precision: row.precision,
            }
          : null,
    }))
  );
}
export function alreadySuggested(rows: GpsDraft[], next: Pick<GpsDraft, "kind" | "label">) {
  const label = (v: string) => v.trim().normalize("NFKC").toLowerCase();
  return rows.some((row) => row.kind === next.kind && label(row.label) === label(next.label));
}
export function suggestionDraft(next: GpsSuggestions["locations"][number], id: string) {
  const locations = gpsLocationsSchema.parse([
    {
      id,
      kind: next.kind,
      label: next.label,
      status: next.status,
      point: next.point
        ? {
            latitude: next.point.latitude,
            longitude: next.point.longitude,
            coordinateSystem: next.point.coordinateSystem,
            precision: next.point.precision,
          }
        : null,
    },
  ]);
  return gpsDrafts(locations)[0]!;
}
