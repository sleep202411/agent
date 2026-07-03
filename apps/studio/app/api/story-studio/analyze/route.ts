export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoryStudioAnalyzeRequest = {
  projectId?: string | null;
  prompt?: string;
  uploadedFileName?: string | null;
  uploadedContent?: string | null;
  locale?: string;
};

type StoryStudioAnalysis = {
  title: string;
  summary: string;
  worldview: string;
  storyKernel: string;
  adaptationDirection: string;
  locations: string[];
  protagonist: {
    name: string;
    role: string;
    summary: string;
  };
  characters: Array<{
    name: string;
    role: string;
    summary: string;
    tags: string[];
  }>;
  clues: Array<{
    title: string;
    summary: string;
    type: string;
    source: string;
    use: string;
    rule: string;
    tags: string[];
  }>;
  plots: Array<{
    title: string;
    summary: string;
    entryGoal: string;
    tags: string[];
  }>;
  endings: Array<{
    title: string;
    type: "truth" | "intervention" | "failure" | "hidden";
    summary: string;
    trigger: string;
    review: string;
    tags: string[];
  }>;
  guardrails: string[];
};

type JsonRecord = Record<string, unknown>;

const DEFAULT_BASE_URL =
  "https://llm-5bmlxd1jjvyn71k0.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen-plus";

function jsonResponse(status: number, body: JsonRecord): Response {
  return Response.json(body, { status });
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 8);
}

function extractJsonObject(text: string): JsonRecord | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return asRecord(JSON.parse(fenced[1]));
      } catch {
        // Continue to brace extraction below.
      }
    }

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return asRecord(JSON.parse(text.slice(start, end + 1)));
      } catch {
        return null;
      }
    }

    return null;
  }
}

function readMessageContent(data: unknown): string {
  const root = asRecord(data);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice.message);
  const content = message.content;

  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const item = asRecord(part);
        return asString(item.text) || asString(item.content);
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function coerceEndingType(value: unknown): StoryStudioAnalysis["endings"][number]["type"] {
  if (value === "truth" || value === "intervention" || value === "failure" || value === "hidden") {
    return value;
  }
  return "truth";
}

function coerceAnalysis(raw: JsonRecord, fallbackTitle: string): StoryStudioAnalysis {
  const protagonist = asRecord(raw.protagonist);
  const characters = Array.isArray(raw.characters) ? raw.characters : [];
  const clues = Array.isArray(raw.clues) ? raw.clues : [];
  const plots = Array.isArray(raw.plots) ? raw.plots : [];
  const endings = Array.isArray(raw.endings) ? raw.endings : [];

  return {
    title: asString(raw.title, fallbackTitle),
    summary: asString(raw.summary, "A playable story draft generated from the creator intake."),
    worldview: asString(raw.worldview, "Worldview pending refinement."),
    storyKernel: asString(
      raw.storyKernel,
      "A central conflict that can become a playable investigation."
    ),
    adaptationDirection: asString(raw.adaptationDirection, "Mystery"),
    locations: asStringArray(raw.locations, ["Opening location"]),
    protagonist: {
      name: asString(protagonist.name, "Protagonist"),
      role: asString(protagonist.role, "Player character"),
      summary: asString(protagonist.summary, "The player-facing point of view character."),
    },
    characters: characters.slice(0, 5).map((item, index) => {
      const record = asRecord(item);
      return {
        name: asString(record.name, `Character ${index + 1}`),
        role: asString(record.role, "Story role"),
        summary: asString(record.summary, "A supporting role for the playable story."),
        tags: asStringArray(record.tags, ["character"]),
      };
    }),
    clues: clues.slice(0, 6).map((item, index) => {
      const record = asRecord(item);
      return {
        title: asString(record.title, `Clue ${index + 1}`),
        summary: asString(record.summary, "A discoverable fact that can gate later reasoning."),
        type: asString(record.type, "evidence"),
        source: asString(record.source, "Player action"),
        use: asString(record.use, "Supports later questions, deductions, or story exits."),
        rule: asString(record.rule, "Must be discovered before the AI can cite it as known fact."),
        tags: asStringArray(record.tags, ["clue"]),
      };
    }),
    plots: plots.slice(0, 5).map((item, index) => {
      const record = asRecord(item);
      return {
        title: asString(record.title, `Plot Node ${index + 1}`),
        summary: asString(record.summary, "A playable phase with an immediate player objective."),
        entryGoal: asString(record.entryGoal, "Let the player understand the current situation."),
        tags: asStringArray(record.tags, ["open action"]),
      };
    }),
    endings: endings.slice(0, 4).map((item, index) => {
      const record = asRecord(item);
      return {
        title: asString(record.title, `Ending ${index + 1}`),
        type: coerceEndingType(record.type),
        summary: asString(record.summary, "A terminal story state."),
        trigger: asString(record.trigger, "Reached through a plot exit condition."),
        review: asString(
          record.review,
          "Summarize the player evidence chain and missed opportunities."
        ),
        tags: asStringArray(record.tags, ["ending"]),
      };
    }),
    guardrails: asStringArray(raw.guardrails, [
      "Do not reveal hidden truth before the player earns the relevant facts.",
    ]),
  };
}

function systemPrompt(locale: string): string {
  const outputLanguage = locale.toLowerCase().startsWith("zh") ? "Chinese" : "English";

  return [
    "You are StoryOS, an expert narrative-system designer for playable AI text games.",
    `Return JSON only. Write all human-readable fields in ${outputLanguage}.`,
    "Analyze the creator intake into a first real canvas structure, not a marketing summary.",
    "The output will become React Flow cards: one story root, character cards, global clue cards, plot-node cards, and ending cards.",
    "Design for player-led text interaction: the player can continue, enter open actions, and occasionally choose AI-suggested action points.",
    "Clues are a global evidence/state pool. Plot nodes can require or unlock clues, but clues must not be treated as known before discovery.",
    "Return concise fields. Avoid long essays. Do not include markdown.",
    "Use this exact JSON shape:",
    JSON.stringify(
      {
        title: "string",
        summary: "string",
        worldview: "string",
        storyKernel: "string",
        adaptationDirection: "Suspense | Romance | Adventure | etc.",
        locations: ["string"],
        protagonist: { name: "string", role: "string", summary: "string" },
        characters: [{ name: "string", role: "string", summary: "string", tags: ["string"] }],
        clues: [
          {
            title: "string",
            summary: "string",
            type: "string",
            source: "string",
            use: "string",
            rule: "string",
            tags: ["string"],
          },
        ],
        plots: [{ title: "string", summary: "string", entryGoal: "string", tags: ["string"] }],
        endings: [
          {
            title: "string",
            type: "truth | intervention | failure | hidden",
            summary: "string",
            trigger: "string",
            review: "string",
            tags: ["string"],
          },
        ],
        guardrails: ["string"],
      },
      null,
      2
    ),
  ].join("\n");
}

export async function POST(request: Request): Promise<Response> {
  let body: StoryStudioAnalyzeRequest;

  try {
    body = (await request.json()) as StoryStudioAnalyzeRequest;
  } catch {
    return jsonResponse(400, { success: false, message: "Invalid JSON body." });
  }

  const prompt = asString(body.prompt);
  const uploadedFileName = asString(body.uploadedFileName ?? "");
  const uploadedContent = asString(body.uploadedContent ?? "");
  const locale = asString(body.locale, "en-US");

  if (!prompt && !uploadedContent) {
    return jsonResponse(400, {
      success: false,
      message: "Provide a story prompt or upload a text document before analysis.",
    });
  }

  const apiKey = process.env.STORY_STUDIO_LLM_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, {
      success: false,
      message: "Missing STORY_STUDIO_LLM_API_KEY. Configure it on the studio server.",
    });
  }

  const baseUrl = (process.env.STORY_STUDIO_LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = process.env.STORY_STUDIO_LLM_MODEL ?? DEFAULT_MODEL;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      max_tokens: 2200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt(locale) },
        {
          role: "user",
          content: JSON.stringify({
            projectId: body.projectId ?? null,
            prompt,
            uploadedFileName: uploadedFileName || null,
            uploadedContent: uploadedContent ? uploadedContent.slice(0, 60000) : null,
          }),
        },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    return jsonResponse(502, {
      success: false,
      message: `StoryOS analysis request failed: ${response.status} ${errorText.slice(0, 500)}`,
    });
  }

  const completion = (await response.json()) as unknown;
  const content = readMessageContent(completion);
  const parsed = extractJsonObject(content);

  if (!parsed) {
    return jsonResponse(502, {
      success: false,
      message: "StoryOS returned a non-JSON analysis payload.",
    });
  }

  const fallbackTitle =
    prompt.length > 56 ? `${prompt.slice(0, 56).trim()}...` : prompt || "Untitled Story";

  return jsonResponse(200, {
    success: true,
    analysis: coerceAnalysis(parsed, fallbackTitle),
  });
}
