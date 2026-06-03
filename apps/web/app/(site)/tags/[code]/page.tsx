import { TagPageClient } from "./_components/tag-page-client";

interface PageProps {
  params: Promise<{ code: string }>;
}

// Generic tag landing page (`/tags/[code]`). First use: the SGWander competition
// (`/tags/sgwander_ai_challenge`). Any tag — active or hidden — gets a shareable
// page listing its public entries; future competitions/themes just create a tag,
// assign IPs, and share the link.
export default async function Page({ params }: PageProps) {
  const { code } = await params;
  return <TagPageClient code={decodeURIComponent(code)} />;
}
