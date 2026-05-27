import { PageSection } from "@/components/page-section";
import { Card, CardContent } from "@/components/ui/card";

export default function AiJobsPage() {
  return (
    <PageSection
      eyebrow="AI Jobs"
      title="Generation job operations"
      description="Monitor queued, running, failed, retried, and settled AI jobs across model products and providers."
    >
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Job table, provider health, queue controls, retry actions, and cost settlement records
          will live here.
        </CardContent>
      </Card>
    </PageSection>
  );
}
