export type ProductionLocale = 'en-US' | 'zh-CN' | 'zh-HK';

export type FolderSeed = {
  key: string;
  names: Record<ProductionLocale, string>;
  children?: FolderSeed[];
};

export const SHARED_FOLDERS: FolderSeed[] = [
  {
    key: 'script',
    names: { 'en-US': 'Script', 'zh-CN': '剧本', 'zh-HK': '劇本' },
  },
  {
    key: 'art',
    names: {
      'en-US': 'Art',
      'zh-CN': '美术资源',
      'zh-HK': '美術資源',
    },
    children: [
      {
        key: 'art.characters',
        names: { 'en-US': 'Characters', 'zh-CN': '角色', 'zh-HK': '角色' },
      },
      {
        key: 'art.scenes',
        names: { 'en-US': 'Scenes', 'zh-CN': '场景', 'zh-HK': '場景' },
      },
      {
        key: 'art.props',
        names: { 'en-US': 'Props', 'zh-CN': '道具', 'zh-HK': '道具' },
      },
    ],
  },
  {
    key: 'music',
    names: { 'en-US': 'Music', 'zh-CN': '音乐', 'zh-HK': '音樂' },
    children: [
      {
        key: 'music.bgm',
        names: {
          'en-US': 'Background music',
          'zh-CN': '背景音乐',
          'zh-HK': '背景音樂',
        },
      },
      {
        key: 'music.voices',
        names: {
          'en-US': 'Character voices',
          'zh-CN': '人物音色',
          'zh-HK': '人物音色',
        },
      },
    ],
  },
  {
    key: 'video',
    names: { 'en-US': 'Video', 'zh-CN': '视频', 'zh-HK': '影片' },
    children: [
      {
        key: 'video.rough',
        names: {
          'en-US': 'Rough cut',
          'zh-CN': '粗剪视频',
          'zh-HK': '粗剪影片',
        },
      },
      {
        key: 'video.fine',
        names: {
          'en-US': 'Fine cut',
          'zh-CN': '精剪视频',
          'zh-HK': '精剪影片',
        },
      },
      {
        key: 'video.subtitled',
        names: {
          'en-US': 'Subtitled',
          'zh-CN': '有字幕视频',
          'zh-HK': '有字幕影片',
        },
      },
    ],
  },
  {
    key: 'other',
    names: { 'en-US': 'Other Tasks', 'zh-CN': '其他任务', 'zh-HK': '其他任務' },
  },
];
