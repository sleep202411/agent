import { PageSection } from "@/components/page-section";
import { Card, CardContent } from "@/components/ui/card";

export default function CampaignsPage() {
  return (
    <PageSection
      eyebrow="Campaigns"
      title="Activity grants and model access"
      description="Configure event-specific free models, quota grants, region rules, and expiry windows without hardcoding job logic."
    >
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Campaign grants, free model quotas, eligibility rules, and usage caps will live here.
        </CardContent>
      </Card>
    </PageSection>
  );
}
