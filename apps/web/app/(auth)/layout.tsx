import { ClickSpark } from "@/components/ui/click-spark";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { AuthMediaPanel } from "./_components/auth-media-panel";

/**
 * Two-pane auth shell. The whole page is wrapped in ClickSpark so
 * clicks anywhere trigger a small radial spark burst from the cursor
 * — canvas overlay, pointer-events-none, doesn't interfere with form
 * interaction below.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClickSpark sparkColor="#ffffff" sparkSize={12} sparkRadius={22} sparkCount={9} duration={500}>
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
    </ClickSpark>
  );
}
