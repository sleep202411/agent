export interface StoryAuthoringPublicError {
  code: string;
  detail: string;
}

/**
 * Keep provider diagnostics, source block ids and graph directions out of
 * user-facing transports. The exact failure remains on StoryAgentRun and in
 * worker logs; clients receive a stable action and an unchanged-work promise.
 */
export function storyAuthoringPublicError(
  code: string | null,
  locale = 'en-US',
): StoryAuthoringPublicError {
  const normalizedCode = code ?? 'STORY_AGENT_AUTHORING_FAILED';
  const language = locale.toLowerCase();
  const isTraditional =
    language.startsWith('zh-hk') || language.startsWith('zh-tw');
  const isChinese = language.startsWith('zh');
  const kind = publicErrorKind(normalizedCode);

  const detail = isChinese
    ? chineseMessage(kind, isTraditional)
    : englishMessage(kind);
  return { code: normalizedCode, detail };
}

type PublicErrorKind = 'content' | 'source' | 'concurrent' | 'generic';

function publicErrorKind(code: string): PublicErrorKind {
  if (code === 'STORY_AGENT_CONTENT_REJECTED') return 'content';
  if (
    code.includes('SOURCE_') ||
    code.includes('SCRIPT_DOCUMENT') ||
    code.startsWith('STORY_AGENT_STAGE_FAILED')
  ) {
    return 'source';
  }
  if (
    code.includes('BASE_') ||
    code.includes('CAS_') ||
    code.includes('STALE')
  ) {
    return 'concurrent';
  }
  return 'generic';
}

function englishMessage(kind: PublicErrorKind): string {
  switch (kind) {
    case 'content':
      return 'The generation provider could not process this source. Your approved work is unchanged. Revise the source wording and try again.';
    case 'source':
      return 'A complete story route could not be generated from this source. Your approved work is unchanged. Try again; if it repeats, make the intended transition explicit.';
    case 'concurrent':
      return 'The story changed while generation was running. Your latest work is unchanged. Start generation again from the current version.';
    default:
      return 'Story generation did not finish. Your approved work is unchanged. Try again.';
  }
}

function chineseMessage(kind: PublicErrorKind, traditional: boolean): string {
  if (traditional) {
    switch (kind) {
      case 'content':
        return '生成服務無法處理這份來源內容。已核准的內容沒有變更；請調整來源文字後重試。';
      case 'source':
        return '未能從來源內容生成完整故事路徑。已核准的內容沒有變更；請重試，若再次失敗，請在原文中明確寫出轉場。';
      case 'concurrent':
        return '生成期間故事已更新。你的最新內容沒有變更；請從目前版本重新生成。';
      default:
        return '故事生成未完成。已核准的內容沒有變更；請重試。';
    }
  }
  switch (kind) {
    case 'content':
      return '生成服务无法处理这份来源内容。已核准的内容没有变更；请调整来源文字后重试。';
    case 'source':
      return '未能从来源内容生成完整故事路径。已核准的内容没有变更；请重试，如再次失败，请在原文中明确写出转场。';
    case 'concurrent':
      return '生成期间故事已更新。你的最新内容没有变更；请从当前版本重新生成。';
    default:
      return '故事生成未完成。已核准的内容没有变更；请重试。';
  }
}
