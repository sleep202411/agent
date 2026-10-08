import { randomUUID } from "node:crypto";
import { runAppearanceDesign } from "../src/appearance/harness.js";

const result = await runAppearanceDesign(
  {
    requestId: randomUUID(),
    prompt:
      process.argv[2] ||
      "Make the choices dark navy with white text, 16px rounded corners and vertically stacked. Keep the playback bar as it is.",
    locale: "en-US",
    appearance: { version: 1 },
    context: { title: "A Dream of Jinling", choiceLabels: ["Enter the courtyard", "Wait outside"] },
    history: [],
  },
  { signal: AbortSignal.timeout(120_000) }
);
console.log(JSON.stringify(result, null, 2));
