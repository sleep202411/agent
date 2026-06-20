"use client";

/**
 * Bare-hero preview of the pollo.ai composer with the 3-way theme toggle
 * (Pollo pink / Mono / Red). The composer + theme + glyphs live in ../_pollo so
 * this preview and the full homepage (../home) share one source of truth.
 * Preview at /<locale>/pollo-clone. The full page lives at /<locale>/home.
 */

import { useState } from "react";
import { Composer } from "../_pollo/composer";
import { THEME_IDS, THEMES, type ThemeId } from "../_pollo/theme";

export default function PolloClonePage() {
  const [themeId, setThemeId] = useState<ThemeId>("pollo");
  const t = THEMES[themeId];

  return (
    <main
      className="relative min-h-screen text-white antialiased transition-colors duration-300"
      style={{ background: t.pageBg, fontFamily: '"Inter", system-ui, -apple-system, sans-serif' }}
    >
      <style>{`@keyframes polloFade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}`}</style>

      <div className="fixed top-4 right-4 z-50 flex items-center gap-1 rounded-full border border-white/10 bg-black/40 p-1 text-[12px] backdrop-blur">
        {THEME_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setThemeId(id)}
            className={[
              "rounded-full px-3 py-1.5 transition",
              themeId === id ? "bg-white/15 text-white" : "text-white/55 hover:text-white/80",
            ].join(" ")}
          >
            {THEMES[id].label}
          </button>
        ))}
      </div>

      <div className="mx-auto flex max-w-[1180px] flex-col items-center px-6 pt-28 pb-24">
        <Composer theme={t} />
      </div>
    </main>
  );
}
