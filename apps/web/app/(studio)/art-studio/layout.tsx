import { StudioSidebar } from "./_components/studio-sidebar";

/**
 * Art-studio sub-layout — mounts the floating capsule sidebar on
 * every `/art-studio/*` route. The sidebar is `fixed`, lives outside
 * the document flow, so children continue to render edge-to-edge.
 */
export default function ArtStudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StudioSidebar />
      {children}
    </>
  );
}
