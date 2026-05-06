import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";

/**
 * Art-studio sub-layout — mounts the studio sidebar (fixed-position
 * floating pill) on every /art-studio/* route. The sidebar lives
 * outside the flow so children render edge-to-edge underneath it.
 */
export default function ArtStudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <WorkspaceSidebar />
      {/* pl-20 clears the fixed sidebar (12px gap + 6px padding + 44px
          icon + 6px padding ≈ 68px) with a small breathing buffer. */}
      <div className="pl-20">{children}</div>
    </>
  );
}
