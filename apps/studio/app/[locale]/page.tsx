/**
 * FizzStudio homepage (route `/`). The pollo.ai-genre composer hero disciplined
 * to our brand, assembled from the shared `_pollo/` system (theme + glyphs +
 * composer) and the home-only chrome/sections in `_home/`.
 *
 * Navigation is the app's shared `StudioSidebar`, while the home content uses
 * imagine.art's 241px desktop content offset so the enterprise/source gallery
 * grid and project rails match the reference geometry.
 *
 * Accent: locked to the **Red** preset (brand red #E52227 on primary CTAs only —
 * Login / Generate / Upgrade / Try Now — neutral everywhere else). To change the
 * accent, swap the one `THEME` line below; `theme.ts` still defines Mono/Pollo.
 * Some imagery is still placeholder CDN content; real-data wiring (Recent
 * Projects, Agent routing, Generate) is a follow-up.
 */

import { StudioSidebar } from "@/app/_components/studio-sidebar";
import { Composer } from "./_pollo/composer";
import { THEMES } from "./_pollo/theme";
import { Footer, HeaderBar } from "./_home/chrome";
import { ExploreMore, Models, RecentProjects } from "./_home/sections";
import { HeroCanvas } from "./_home/hero-canvas";
import { CheckInCard } from "./settings/_components/check-in-card";

const THEME = THEMES.red;

export default function HomePage() {
  return (
    <div
      className="relative min-h-screen w-full text-white antialiased"
      style={{
        background: THEME.pageBg,
        fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
      }}
    >
      <style>{`@keyframes polloFade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}`}</style>

      {/* imagine.art enterprise-style decorative collaboration canvas */}
      <HeroCanvas />

      {/* shared icon rail (fixed, vertically centered, lg+ only) */}
      <StudioSidebar />

      {/* header + content float over the backdrop */}
      <div className="relative z-10">
        <HeaderBar theme={THEME} />
        <main className="lg:pl-[241px]">
          <div className="px-6 pt-10">
            <Composer theme={THEME} />
          </div>
          <div className="px-6 pt-8">
            <div className="mx-auto max-w-3xl">
              <CheckInCard compact />
            </div>
          </div>
          <RecentProjects theme={THEME} />
          <Models theme={THEME} />
          <ExploreMore />
          <Footer theme={THEME} />
        </main>
      </div>
    </div>
  );
}
