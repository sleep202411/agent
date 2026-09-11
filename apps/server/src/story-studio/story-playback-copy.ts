/** Localized defaults for authored fields that are still empty during playtest. */
const COPY = {
  'en-US': { prompt: 'Choose an option', option: 'Option', scene: 'Scene' },
  'zh-CN': { prompt: '请选择', option: '选项', scene: '场景' },
  'zh-HK': { prompt: '請選擇', option: '選項', scene: '場景' },
};

export function storyPlaybackCopy(locale: string) {
  return COPY[locale as keyof typeof COPY] ?? COPY['en-US'];
}

export const STORY_PREVIEW_SCENE_DURATION_MS = 4_000;
