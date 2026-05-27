import { PageSection } from "@/components/page-section";

export default function AuditLogsPage() {
  return (
    <PageSection
      eyebrow="Audit Logs"
      title="Operator activity trail"
      description="Every sensitive admin action should be attributable, searchable, and safe to reconcile during incidents."
    >
      <div className="rounded-lg border border-[#262629] bg-[#141416] p-6 text-sm text-[#9ca0a8]">
        Audit log search, action details, before/after payloads, and incident exports will live
        here.
      </div>
    </PageSection>
  );
}
