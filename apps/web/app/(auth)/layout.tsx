import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { AuthMediaPanel } from "./_components/auth-media-panel";

/**
 * Two-pane auth shell.
 *
 * The radial click-spark canvas overlay was removed 2026-05-07 — the
 * burst was distracting on form interactions and added a canvas layer
 * the auth flow doesn't otherwise need. If we want it back later,
 * re-import `<ClickSpark>` from `@/components/ui/click-spark` and wrap
 * the outer `<div>`.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <section className="relative flex flex-1 justify-center overflow-auto">
        <div className="absolute right-4 top-4 z-10">
          <LanguageSwitcher />
        </div>
        <div className="flex w-full max-w-[474px] flex-col justify-center px-6 py-16 lg:py-0">
          {children}
        </div>
      </section>
      <AuthMediaPanel />
    </div>
  );
}
