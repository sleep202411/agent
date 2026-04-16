/**
 * i18n-ready model descriptions.
 * Key matches serviceCode or serviceName (case-insensitive).
 */
export const MODEL_DESCRIPTIONS: Record<string, Record<string, string>> = {
  // Image
  "seed-1.6": {
    "zh-CN": "字节跳动 Seed 系列，擅长写实人像和复杂场景，色彩细腻",
    "zh-HK": "字節跳動 Seed 系列，擅長寫實人像和複雜場景，色彩細膩",
    "en-US":
      "ByteDance Seed series, excels at realistic portraits and complex scenes with rich colors",
  },
  "wan2.5": {
    "zh-CN": "阿里通义万相，生成速度快，适合快速预览和迭代",
    "zh-HK": "阿里通義萬相，生成速度快，適合快速預覽和迭代",
    "en-US": "Alibaba Wan, fast generation speed, ideal for quick previews",
  },
  "wan2.5-i2i-preview": {
    "zh-CN": "通义万相图生图模式，基于参考图风格化生成",
    "zh-HK": "通義萬相圖生圖模式，基於參考圖風格化生成",
    "en-US": "Wan image-to-image mode, style transfer based on reference image",
  },
  "google/nano-banana": {
    "zh-CN": "Google 轻量模型，速度极快，适合草图和概念验证",
    "zh-HK": "Google 輕量模型，速度極快，適合草圖和概念驗證",
    "en-US": "Google lightweight model, ultra-fast, ideal for sketches and concept validation",
  },
  "google/nano-banana-pro": {
    "zh-CN": "Google 增强版，画面质量更高，细节更丰富",
    "zh-HK": "Google 增強版，畫面質量更高，細節更豐富",
    "en-US": "Google enhanced version, higher image quality with richer details",
  },
  "bytedance/seedream-4.5": {
    "zh-CN": "字节跳动最新模型，画面精致，风格多样，支持中文理解",
    "zh-HK": "字節跳動最新模型，畫面精緻，風格多樣，支持中文理解",
    "en-US": "ByteDance latest model, exquisite visuals, diverse styles, Chinese understanding",
  },
  "gem:3.1-2k": {
    "zh-CN": "GEM 系列 2K 超高清输出，适合需要大尺寸印刷的场景",
    "zh-HK": "GEM 系列 2K 超高清輸出，適合需要大尺寸印刷的場景",
    "en-US": "GEM series 2K ultra-HD output, ideal for large-format printing",
  },
  "gem:3.1-1k": {
    "zh-CN": "GEM 系列 1K 标准输出，画质与速度的平衡之选",
    "zh-HK": "GEM 系列 1K 標準輸出，畫質與速度的平衡之選",
    "en-US": "GEM series 1K standard output, balanced quality and speed",
  },
  mj_imagine: {
    "zh-CN": "Midjourney 经典模式，一次生成 4 张 2x2 网格图",
    "zh-HK": "Midjourney 經典模式，一次生成 4 張 2x2 網格圖",
    "en-US": "Midjourney classic mode, generates 4 images in a 2x2 grid",
  },
  "mj:v7": {
    "zh-CN": "Midjourney 最新 v7 模型，艺术表现力强，风格独特",
    "zh-HK": "Midjourney 最新 v7 模型，藝術表現力強，風格獨特",
    "en-US": "Midjourney latest v7 model, strong artistic expression, unique style",
  },
  // Video
  "kwaivgi/kling-v2.6": {
    "zh-CN": "快手可灵 2.6，运动幅度大，适合动作场景",
    "zh-HK": "快手可靈 2.6，運動幅度大，適合動作場景",
    "en-US": "Kuaishou Kling 2.6, large motion range, ideal for action scenes",
  },
  "wan2.6-i2v-flash": {
    "zh-CN": "通义万相极速版，3 秒出片，适合快速预览",
    "zh-HK": "通義萬相極速版，3 秒出片，適合快速預覽",
    "en-US": "Wan flash version, 3-second generation, ideal for quick previews",
  },
  "wan2.6-i2v": {
    "zh-CN": "通义万相标准版，画面稳定，动态自然",
    "zh-HK": "通義萬相標準版，畫面穩定，動態自然",
    "en-US": "Wan standard version, stable visuals, natural motion",
  },
  "minimax/hailuo-02": {
    "zh-CN": "MiniMax 海螺 02，人物表情细腻，适合对话场景",
    "zh-HK": "MiniMax 海螺 02，人物表情細膩，適合對話場景",
    "en-US": "MiniMax Hailuo 02, detailed facial expressions, ideal for dialogue scenes",
  },
  "minimax/hailuo-2.3": {
    "zh-CN": "海螺最新版，运动一致性强，画面更稳定",
    "zh-HK": "海螺最新版，運動一致性強，畫面更穩定",
    "en-US": "Hailuo latest, strong motion consistency, more stable visuals",
  },
  "kling-3.0-720p": {
    "zh-CN": "可灵 3.0 标清版，性价比高，适合批量生成",
    "zh-HK": "可靈 3.0 標清版，性價比高，適合批量生成",
    "en-US": "Kling 3.0 720p, cost-effective, ideal for batch generation",
  },
  "kling-3.0-1080p": {
    "zh-CN": "可灵 3.0 高清版，画质细腻，适合最终成片",
    "zh-HK": "可靈 3.0 高清版，畫質細膩，適合最終成片",
    "en-US": "Kling 3.0 1080p, fine quality, ideal for final production",
  },
  "hailuo-2.3-768p": {
    "zh-CN": "海螺 2.3 标清版，低成本快速生成",
    "zh-HK": "海螺 2.3 標清版，低成本快速生成",
    "en-US": "Hailuo 2.3 768p, low-cost fast generation",
  },
  "hailuo-2.3-1080p": {
    "zh-CN": "海螺 2.3 高清版，画质清晰，适合正式输出",
    "zh-HK": "海螺 2.3 高清版，畫質清晰，適合正式輸出",
    "en-US": "Hailuo 2.3 1080p, clear quality, ideal for formal output",
  },
};

export function getModelDescription(
  serviceCode?: string,
  serviceName?: string,
  locale = "zh-CN"
): string | undefined {
  const code = String(serviceCode ?? "").toLowerCase();
  const name = String(serviceName ?? "").toLowerCase();
  const entry = MODEL_DESCRIPTIONS[code] ?? MODEL_DESCRIPTIONS[name];
  if (!entry) return undefined;
  return entry[locale] ?? entry["en-US"] ?? Object.values(entry)[0];
}
