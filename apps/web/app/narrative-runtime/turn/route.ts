import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NarrativeTurnAction = "freeInput" | "choice" | "continue";

type RuntimeNextState = "stay" | "advancePlot" | "ending";

type RuntimeEndingId = "truth" | "intervention" | "coverup";

type NarrativeTurnRequest = {
  action?: NarrativeTurnAction;
  locale?: string;
  playerText?: string;
  storyId?: string;
  setup?: {
    details?: string;
    direction?: string;
    freedom?: string;
    hintLevel?: string;
    identity?: string;
    name?: string;
    pace?: string;
    role?: string;
  };
  story?: Array<{
    kind?: "narrator" | "player" | "system";
    body?: string;
    meta?: string;
    clueIds?: string[];
  }>;
  unlockedClueIds?: string[];
  currentPlot?: {
    id?: string;
    title?: string;
    location?: string;
    objective?: string;
    boundary?: string;
  };
  currentSuggestedActions?: string[];
  risk?: number;
  turnCount?: number;
};

type CharacterSpeakerId = "brother" | "receptionTeacher" | "securityGuard" | "linFeng";

type NarrativeTurnResponse = {
  response: string;
  judgement: string;
  clueIds: string[];
  endingId?: RuntimeEndingId;
  nextPlotId?: "plotA" | "plotB";
  nextState: RuntimeNextState;
  riskDelta: number;
  speakerId?: CharacterSpeakerId;
  suggestedActions: string[];
};

const QWEN_BASE_URL =
  process.env.NARRATIVE_QWEN_BASE_URL?.trim() ||
  process.env.ALIBABA_BASE_URL?.trim() ||
  "https://llm-5bmlxd1jjvyn71k0.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";
const QWEN_MODEL =
  process.env.NARRATIVE_QWEN_MODEL?.trim() || process.env.ALIBABA_MODEL?.trim() || "qwen-plus";

const CLUE_CATALOG = {
  transfer_date: {
    title: "转学通知书日期异常",
    rule: "只有玩家检查、出示或追问转学通知书时才能解锁。",
  },
  brother_read: {
    title: "哥哥没有回复但已读",
    rule: "只有玩家联系哥哥、提到短信/电话/消息时才能解锁。",
  },
  guard_name: {
    title: "保安提前知道主角姓名",
    rule: "只有玩家观察校门、保安、登记流程或安保反应时才能解锁。",
  },
  case_report_no_struggle: {
    title: "事故简报写着无挣扎痕迹",
    rule: "只有玩家查看事故简报、听见自杀定性、关注无挣扎痕迹或指甲缝泥沙时才能解锁。",
  },
} as const;

const VALID_CLUE_IDS = new Set(Object.keys(CLUE_CATALOG));
const VALID_SPEAKER_IDS = new Set(["brother", "receptionTeacher", "securityGuard", "linFeng"]);
const PLOT_CLUE_IDS: Record<string, Array<keyof typeof CLUE_CATALOG>> = {
  plotA: ["transfer_date", "brother_read", "guard_name"],
  plotB: ["case_report_no_struggle", "brother_read"],
};

const MIN_TOTAL_TURNS_BEFORE_PLOT_B = 2;
const MIN_TOTAL_TURNS_BEFORE_ENDING = 6;

const ENDING_CATALOG = {
  truth: "真相结局：证据链成立，玩家能够证明溺亡案不是自杀。",
  intervention: "哥哥介入结局：风险过高或触碰更大真相，哥哥强制把主角带离现场。",
  coverup: "表面自杀结局：证据不足或关键线索被错过，案件继续被按自杀处理。",
} as const;

export async function POST(request: NextRequest) {
  const apiKey =
    process.env.NARRATIVE_QWEN_API_KEY?.trim() ||
    process.env.ALIBABA_API_KEY?.trim() ||
    process.env.DASHSCOPE_API_KEY?.trim() ||
    process.env.BAILIAN_API_KEY?.trim();

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "NARRATIVE_QWEN_API_KEY / ALIBABA_API_KEY / DASHSCOPE_API_KEY is not set on the web server.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  let payload: NarrativeTurnRequest;
  try {
    payload = (await request.json()) as NarrativeTurnRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const action = payload.action ?? "freeInput";
  const playerText = (payload.playerText ?? "").trim();
  if (action !== "continue" && !playerText) {
    return NextResponse.json(
      { error: "playerText is required for this turn." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  const recentStory = getRecentStory(payload);
  const currentPlot = getCurrentPlot(payload);

  try {
    const upstream = await fetch(`${QWEN_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: QWEN_MODEL,
        messages: buildMessages(payload, recentStory, currentPlot),
        temperature: 0.72,
        max_tokens: 650,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    const raw = await upstream.text();
    let upstreamJson: unknown;
    try {
      upstreamJson = raw ? JSON.parse(raw) : {};
    } catch {
      upstreamJson = raw;
    }

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: `Qwen request failed: HTTP ${upstream.status}`,
          detail: typeof upstreamJson === "string" ? upstreamJson : JSON.stringify(upstreamJson),
        },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    const content = extractAssistantText(upstreamJson);
    const parsed = parseModelJson(content);
    const result = normalizeTurnResult(
      parsed,
      action,
      payload.unlockedClueIds ?? [],
      recentStory,
      currentPlot.id,
      typeof payload.risk === "number" ? payload.risk : 0,
      typeof payload.turnCount === "number" ? payload.turnCount : 0
    );

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Qwen request timed out."
        : error instanceof Error
          ? error.message
          : "Qwen request failed.";

    return NextResponse.json(
      { error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  } finally {
    clearTimeout(timer);
  }
}

function getRecentStory(payload: NarrativeTurnRequest) {
  return (payload.story ?? []).slice(-10).map((entry) => ({
    kind: entry.kind,
    meta: entry.meta,
    body: entry.body,
    clueIds: entry.clueIds ?? [],
  }));
}

function getCurrentPlot(payload: NarrativeTurnRequest) {
  return {
    id: payload.currentPlot?.id || "plotA",
    title: payload.currentPlot?.title || "进入精英学校",
    location: payload.currentPlot?.location || "精英学校校门",
    objective:
      payload.currentPlot?.objective || "建立处境：她被送来矫正，但学校和哥哥都在控制信息。",
    boundary:
      payload.currentPlot?.boundary ||
      "只能处理校门登记、转学通知书、接待老师、保安和哥哥消息；不能提前进入溺亡案、校长室或真凶。",
  };
}

function buildMessages(
  payload: NarrativeTurnRequest,
  recentStory: ReturnType<typeof getRecentStory>,
  currentPlot: ReturnType<typeof getCurrentPlot>
) {
  const availableClueIds = PLOT_CLUE_IDS[currentPlot.id] ?? PLOT_CLUE_IDS.plotA;

  return [
    {
      role: "system",
      content: [
        "你是 FizzDragon 文字游戏的运行时导演。你负责接住玩家自由输入或继续按钮，并生成下一段可玩的中文叙事。",
        "故事：现代中国，一名 17 岁少女被送往精英学校“矫正”，实则拥有过目不忘与超强逻辑推演。首宗案件是同学“意外溺毙”，警方草草定性为自杀。她会在 36 小时内揭开这是谋杀，但真相必须逐步显露。",
        `当前剧情节点：${currentPlot.id} / ${currentPlot.title} / ${currentPlot.location}。目标：${currentPlot.objective}`,
        `剧情边界：${currentPlot.boundary}`,
        "你必须限制剧情：不能直接进入校长办公室，不能揭露真凶，不能凭空给证据。只有当前节点允许的信息可以出现。",
        "允许玩家自由行动，但要把动作归类为观察环境、检查转学通知书、询问接待老师、联系哥哥、拒绝配合或保持沉默之一；离题输入要自然拉回当前场景。",
        "playerProfile.selectedRole、adaptationDirection、pace、hintLevel、freedom 是玩家开局校准：用它们调整叙事视角、类型氛围、节奏、提示力度和开放输入边界；但不得提前泄露真相、绕过线索条件或跳过剧情节点边界。",
        "每次 response 都必须从 recentStory 的最后一段之后继续推进，禁止复述、改写或轻微变体重复最近 3 段叙事。尤其是 action=continue 时，必须出现新的外部动作、对话、位置变化或时间推进；不要让同一张通知书、同一个手势、同一个物件悬停多回合。",
        "只允许解锁这些线索：" +
          availableClueIds
            .map((id) => `${id}=${CLUE_CATALOG[id].title}（${CLUE_CATALOG[id].rule}）`)
            .join("；"),
        `可用结局：${Object.entries(ENDING_CATALOG)
          .map(([id, desc]) => `${id}=${desc}`)
          .join("；")}`,
        "你还必须判断本回合之后故事运行状态：nextState 只能是 stay、advancePlot、ending。",
        "stay 表示继续停留在当前剧情节点；advancePlot 表示进入下一剧情节点，目前只允许 plotA -> plotB；ending 表示本局结束，必须同时给 endingId。",
        "进入 plotB 的条件：至少完成 2 个玩家回合，并且玩家在 plotA 已经明确获得至少两个入校异常证据，或已经完成入校手续且发现校方提前预设身份。",
        "进入结局的条件：至少完成 6 个玩家回合，并且 plotB 中证据链足够完整可进入 truth；风险过高或哥哥强干预进入 intervention；多回合未形成证据链且校方/警方压下事件进入 coverup。",
        "clueIds 只能返回本回合新解锁的线索。已经在 unlockedClueIds 里的线索绝对不能再次返回；如果没有新线索，必须返回 []。",
        "返回必须是 JSON 对象，不要 Markdown，不要代码块。字段必须为：response(string), judgement(string), clueIds(string[]), riskDelta(number), nextState(string), nextPlotId(string|null), endingId(string|null), speakerId(string|null), suggestedActions(string[])。",
        "response 用 2-4 段中文叙事，必须适合直接显示给玩家。不要解释系统规则。不要出现无法追踪的关键事实。",
        "speakerId 只能是 brother、receptionTeacher、securityGuard、linFeng 或 null。若无明确角色回应，返回 null。",
        "suggestedActions 是给玩家的下一步灵感，不是固定剧情分支。最多 3 个，每个 6-16 个中文字符，必须贴合当前场景；如果当前不需要建议，可以返回 []。",
        "suggestedActions 不要直接返回“观察环境、检查转学通知书、询问接待老师、联系哥哥”等分类名，也不要重复 currentSuggestedActions；要写成当前文本之后可执行的小动作，例如“翻看通知书背面”“留意保安手势”。",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        action: payload.action ?? "freeInput",
        locale: payload.locale ?? "zh-CN",
        playerText: payload.playerText ?? "",
        playerProfile: {
          name: payload.setup?.name || "林风",
          identity: payload.setup?.identity || "被送入精英学校的 17 岁少女",
          details: payload.setup?.details || "",
          selectedRole: payload.setup?.role || "linFeng",
          adaptationDirection: payload.setup?.direction || "mystery",
          pace: payload.setup?.pace || "standard",
          hintLevel: payload.setup?.hintLevel || "normal",
          freedom: payload.setup?.freedom || "balanced",
        },
        currentPlot,
        unlockedClueIds: payload.unlockedClueIds ?? [],
        currentSuggestedActions: payload.currentSuggestedActions ?? [],
        risk: typeof payload.risk === "number" ? payload.risk : 0,
        turnCount: payload.turnCount ?? 0,
        recentStory,
      }),
    },
  ];
}

function extractAssistantText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const text = (item as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function parseModelJson(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

function normalizeTurnResult(
  raw: Record<string, unknown>,
  action: NarrativeTurnAction,
  unlockedClueIds: string[],
  recentStory: Array<{ kind?: "narrator" | "player" | "system"; body?: string }>,
  currentPlotId: string,
  currentRisk: number,
  turnCount: number
): NarrativeTurnResponse {
  const responseCandidate =
    typeof raw.response === "string" && raw.response.trim()
      ? raw.response.trim()
      : action === "continue"
        ? "接待老师终于抬起眼，像是刚刚确认了某个名单。她没有解释，只把登记册推近半寸，示意你把名字写下。门后的走廊安静得过分，连脚步声都像被校规压低。"
        : "你的动作被接住了，但这里的秩序没有立刻松动。有人看见了你的迟疑，也有人假装什么都没发生。";
  const response = isRepeatedNarration(responseCandidate, recentStory)
    ? action === "continue"
      ? "林守业终于收回指向侧铁门的手，登记簿被他翻到下一页。纸页摩擦声很轻，却像在提醒你：再站在原地只会被他们记录。侧门后传来一声短促的电锁响，接待老师的脚步声从走廊尽头靠近。"
      : "你的动作让林守业短暂移开视线。登记台后的黑屏暗下去，侧门的电子锁却亮了一下，像是有人在里面替你放行。接待老师的声音从门后传来，冷静得像早已排练过。"
    : responseCandidate;

  const judgement =
    typeof raw.judgement === "string" && raw.judgement.trim()
      ? raw.judgement.trim()
      : action === "continue"
        ? "继续场景"
        : "自由行动";

  const unlocked = new Set(unlockedClueIds);
  const allowedClueIds = new Set(PLOT_CLUE_IDS[currentPlotId] ?? PLOT_CLUE_IDS.plotA);
  const clueIds = Array.isArray(raw.clueIds)
    ? raw.clueIds.filter(
        (item): item is string =>
          typeof item === "string" &&
          VALID_CLUE_IDS.has(item) &&
          allowedClueIds.has(item as keyof typeof CLUE_CATALOG) &&
          !unlocked.has(item)
      )
    : [];

  const rawRisk = typeof raw.riskDelta === "number" ? raw.riskDelta : 0;
  const riskDelta = Math.max(0, Math.min(3, Math.round(rawRisk)));
  const nextRisk = Math.max(0, Math.min(9, Math.round(currentRisk + riskDelta)));

  const speakerId =
    typeof raw.speakerId === "string" && VALID_SPEAKER_IDS.has(raw.speakerId)
      ? (raw.speakerId as CharacterSpeakerId)
      : undefined;
  const suggestedActions = normalizeSuggestedActions(raw.suggestedActions);
  const runtimeState = normalizeRuntimeState(
    raw,
    currentPlotId,
    unlockedClueIds,
    clueIds,
    nextRisk,
    turnCount + 1
  );

  return { response, judgement, clueIds, riskDelta, speakerId, suggestedActions, ...runtimeState };
}

function normalizeRuntimeState(
  raw: Record<string, unknown>,
  currentPlotId: string,
  unlockedClueIds: string[],
  turnClueIds: string[],
  nextRisk: number,
  nextTurnCount: number
): Pick<NarrativeTurnResponse, "endingId" | "nextPlotId" | "nextState"> {
  const nextUnlocked = new Set([...unlockedClueIds, ...turnClueIds]);
  const requestedNextState =
    raw.nextState === "advancePlot" || raw.nextState === "ending" ? raw.nextState : "stay";
  const requestedNextPlotId =
    raw.nextPlotId === "plotA" || raw.nextPlotId === "plotB" ? raw.nextPlotId : undefined;
  const requestedEndingId =
    raw.endingId === "truth" || raw.endingId === "intervention" || raw.endingId === "coverup"
      ? raw.endingId
      : undefined;

  if (currentPlotId === "plotA") {
    if (
      nextTurnCount >= MIN_TOTAL_TURNS_BEFORE_PLOT_B &&
      requestedNextState === "advancePlot" &&
      requestedNextPlotId === "plotB"
    ) {
      return { nextPlotId: "plotB", nextState: "advancePlot" };
    }

    if (shouldAdvanceToPlotB(nextUnlocked, nextTurnCount)) {
      return { nextPlotId: "plotB", nextState: "advancePlot" };
    }

    return { nextState: "stay" };
  }

  if (currentPlotId === "plotB") {
    if (nextTurnCount < MIN_TOTAL_TURNS_BEFORE_ENDING) {
      return { nextState: "stay" };
    }

    if (requestedNextState === "ending" && requestedEndingId) {
      return { endingId: requestedEndingId, nextState: "ending" };
    }

    if (nextRisk >= 5) {
      return { endingId: "intervention", nextState: "ending" };
    }

    if (nextUnlocked.has("case_report_no_struggle") && nextUnlocked.size >= 3) {
      return { endingId: "truth", nextState: "ending" };
    }

    if (nextTurnCount >= 10 && !nextUnlocked.has("case_report_no_struggle")) {
      return { endingId: "coverup", nextState: "ending" };
    }
  }

  return { nextState: "stay" };
}

function shouldAdvanceToPlotB(unlockedClueIds: Set<string>, nextTurnCount: number) {
  if (nextTurnCount < MIN_TOTAL_TURNS_BEFORE_PLOT_B) return false;

  return (
    (unlockedClueIds.has("guard_name") && unlockedClueIds.has("transfer_date")) ||
    (unlockedClueIds.has("guard_name") && unlockedClueIds.has("brother_read"))
  );
}

function normalizeNarration(text: string) {
  return text.replace(/\s+/g, "").replace(/[，。、“”‘’：；,.!?:;'"-]/g, "");
}

function isRepeatedNarration(
  response: string,
  recentStory: Array<{ kind?: "narrator" | "player" | "system"; body?: string }>
) {
  const normalizedResponse = normalizeNarration(response);
  if (!normalizedResponse) return false;

  return recentStory
    .filter((entry) => entry.kind === "narrator" && typeof entry.body === "string")
    .slice(-3)
    .some((entry) => normalizeNarration(entry.body ?? "") === normalizedResponse);
}

function normalizeSuggestedActions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length >= 2)
        .map((item) => item.slice(0, 28))
    )
  ).slice(0, 3);
}
