import { HomeHero } from "./_components/home-hero";
import { RecentProjects } from "./_components/recent-projects";
import { GalleryPreview } from "./_components/gallery-preview";
import { ImageStudio } from "./images/_components/image-studio";

export default function HomePage() {
  return (
    <main className="w-full px-4 py-8 sm:px-6">
      <HomeHero />

      <RecentProjects />

      <GalleryPreview />

      {/* Composer only — the create bar; the feed lives in the Gallery above. */}
      <ImageStudio showFeed={false} />
    </main>
  );
}
