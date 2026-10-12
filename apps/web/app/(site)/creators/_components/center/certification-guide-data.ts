/** Presentation-only categories approved by Pax. Never changes certificate IDs or eligibility. */
export const certificationGroups = [
  { key: "partner", entries: ["city", "distributor", "instructor", "opc"] },
  { key: "director", entries: ["fd1", "fd2", "fd3", "fd4", "fd5"] },
  { key: "skill", entries: ["producer", "art", "director", "editor", "music", "writer"] },
] as const;
export const certificationAliases: Record<string, string[]> = {
  city: ["City Partner", "城市合伙人", "城市合夥人"],
  distributor: ["Distributor", "分销商", "分銷商", "发行人", "發行人"],
  instructor: ["Instructor", "讲师", "講師"],
  opc: ["OPC Founder", "OPC创始人", "OPC創始人", "OPC 创始人", "OPC 創辦人"],
  producer: ["AI Producer", "AI制片人", "AI製片人", "AI 制片人", "AI 製片人"],
  art: ["Art Director", "艺术总监", "藝術總監", "美术导演", "美術導演"],
  director: ["Director", "导演", "導演"],
  editor: ["Editor", "Video Editor", "剪辑师", "剪輯師"],
  music: ["Music Composer", "音乐作曲", "音樂作曲", "配乐师", "配樂師"],
  writer: ["Writer", "Scriptwriter", "Scriptwritter", "编剧", "編劇"],
};
export function certificationEntry(name: string): string | undefined {
  const fd = name.trim().match(/^FD\s*[-－–]?\s*(III|IV|II|V|I|[1-5])(?=$|[\s·.・-])/i);
  if (fd) {
    const rank =
      ({ I: 1, II: 2, III: 3, IV: 4, V: 5 } as Record<string, number>)[fd[1]!.toUpperCase()] ??
      Number(fd[1]);
    return `fd${rank}`;
  }
  return Object.entries(certificationAliases).find(([, aliases]) =>
    aliases.some((alias) => alias.toLowerCase() === name.trim().toLowerCase())
  )?.[0];
}
export function certificationGroup(name: string): string {
  const entry = certificationEntry(name);
  return (
    certificationGroups.find((group) => (group.entries as readonly string[]).includes(entry ?? ""))
      ?.key ?? "other"
  );
}
