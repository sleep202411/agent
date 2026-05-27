import { PageSection } from "@/components/page-section";
import { Card, CardContent } from "@/components/ui/card";

export default function AuditLogsPage() {
  return (
    <PageSection
      eyebrow="Audit Logs"
      title="Operator activity trail"
      description="Every sensitive admin action should be attributable, searchable, and safe to reconcile during incidents."
    >
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Audit log search, action details, before/after payloads, and incident exports will live
          here.
        </CardContent>
      </Card>
    </PageSection>
  );
}
