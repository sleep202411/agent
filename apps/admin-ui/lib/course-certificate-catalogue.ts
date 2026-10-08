export type CourseCertificateOption = {
  id: number;
  name: string;
};

export function overlayCertificateCatalogue<T extends { certificates?: CourseCertificateOption[] }>(
  mapping: T,
  levels: CourseCertificateOption[]
): T {
  if (levels.length === 0) return mapping;
  return {
    ...mapping,
    certificates: [...levels]
      .sort((left, right) => left.id - right.id)
      .map((level) => ({ id: level.id, name: level.name })),
  };
}
