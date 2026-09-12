/** Project membership follows the current route, never the selected workspace. */
export function settingsMemberProject(pathname: string) {
  const canvas = pathname.match(/^\/project\/([^/]+)(?:\/|$)/);
  if (canvas) return { kind: "project" as const, id: canvas[1]! };
  const story = pathname.match(/^\/story-studio\/projects\/([^/]+)(?:\/|$)/);
  if (story) return { kind: "story-project" as const, id: story[1]! };
  return null;
}
