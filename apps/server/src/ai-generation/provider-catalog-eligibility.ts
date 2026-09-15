/** New admission is separate from endpoint lookup for already submitted jobs. */
export function providerBindingAdmissionEligible(row: {
  canonicalModel: { status: string; archivedAt: Date | null };
  providerEndpoint: { status: string; archivedAt: Date | null };
}): boolean {
  return (
    row.canonicalModel.status === 'active' &&
    row.canonicalModel.archivedAt === null &&
    row.providerEndpoint.status === 'active' &&
    row.providerEndpoint.archivedAt === null
  );
}
