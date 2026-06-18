import { HomeHero } from "./_components/home-hero";
import { RecentProjects } from "./_components/recent-projects";
import { GalleryPreview } from "./_components/gallery-preview";

export default function HomePage() {
  return (
    <main className="w-full px-4 py-0 sm:px-6">
      <HomeHero />

      <RecentProjects />

      <GalleryPreview />
    </main>
  );
}
