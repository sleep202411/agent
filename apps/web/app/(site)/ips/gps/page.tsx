import { Suspense } from "react";
import { ContentGpsDiscovery } from "../_components/content-gps-discovery";
export default function ContentGpsPage() {
  return (
    <Suspense>
      <ContentGpsDiscovery />
    </Suspense>
  );
}
