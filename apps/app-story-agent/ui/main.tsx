import { loadContext, StoryTransport } from "./transport";
import { mountStoryAgent } from "./runtime";
import { connectStoryBridge } from "./bridge";
import "./style.css";

const container = document.getElementById("story-agent")!;
let bridge: ReturnType<typeof connectStoryBridge>;
try {
  bridge = connectStoryBridge();
  const context = await loadContext(bridge);
  document.documentElement.lang = context.locale;
  const dispose = await mountStoryAgent(
    container,
    new StoryTransport(context, undefined, undefined, bridge)
  );
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) void dispose();
  });
} catch (error) {
  bridge?.dispose();
  container.removeAttribute("aria-busy");
  container.setAttribute("role", "alert");
  container.textContent = error instanceof Error ? error.message : String(error);
}
