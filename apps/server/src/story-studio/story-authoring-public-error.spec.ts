import { storyAuthoringPublicError } from './story-authoring-public-error';

describe('storyAuthoringPublicError', () => {
  it('does not expose source node ids or routing diagnostics', () => {
    const result = storyAuthoringPublicError(
      'STORY_AGENT_SOURCE_FIDELITY_FAILED',
      'en-US',
    );
    expect(result.detail).toContain('approved work is unchanged');
    expect(result.detail).not.toContain('source_98');
    expect(result.detail).not.toContain('INCOMING');
  });

  it('localizes the actionable message without changing the diagnostic code', () => {
    expect(
      storyAuthoringPublicError('STORY_AGENT_SOURCE_AUDIT_INCOMPLETE', 'zh-CN'),
    ).toEqual({
      code: 'STORY_AGENT_SOURCE_AUDIT_INCOMPLETE',
      detail:
        '未能从来源内容生成完整故事路径。已核准的内容没有变更；请重试，如再次失败，请在原文中明确写出转场。',
    });
  });
});
