import { loadContext, StoryTransport } from "./transport";
import { mountStoryAgent } from "./runtime";
import "./style.css";

const container = document.getElementById("story-agent")!;
try {
  const context = await loadContext();
  document.documentElement.lang = context.locale;
  const dispose = await mountStoryAgent(container, new StoryTransport(context));
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) void dispose();
  });
} catch (error) {
  container.removeAttribute("aria-busy");
  container.setAttribute("role", "alert");
  container.textContent = error instanceof Error ? error.message : String(error);
}
