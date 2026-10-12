import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import Layout from "./layout";
const state = vi.hoisted(() => ({ userAgent: "Mozilla/5.0" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": state.userAgent }),
}));
vi.mock("@/components/layout/auth-gate", () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/layout/global-nav", () => ({ GlobalNav: () => <nav>Site navigation</nav> }));
vi.mock("@/app/(site)/crews/_components/crew-section-navigation", () => ({
  CrewSectionNavigation: () => <nav>Production navigation</nav>,
}));
it.each(["Mozilla/5.0", "FizzDragonApp/2.5.0"])(
  "retains workspace content and appropriate navigation for %s",
  async (agent) => {
    state.userAgent = agent;
    const html = renderToStaticMarkup(await Layout({ children: <section>Crew tasks</section> }));
    expect(html).toContain("Crew tasks");
    if (agent.includes("FizzDragonApp")) {
      expect(html).not.toContain("Site navigation");
      expect(html).not.toContain("Production navigation");
    } else {
      expect(html).toContain("Site navigation");
      expect(html).toContain("Production navigation");
    }
  }
);
