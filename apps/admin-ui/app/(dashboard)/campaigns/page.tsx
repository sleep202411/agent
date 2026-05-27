import { PageSection } from "@/components/page-section";

export default function CampaignsPage() {
  return (
    <PageSection
      eyebrow="Campaigns"
      title="Activity grants and model access"
      description="Configure event-specific free models, quota grants, region rules, and expiry windows without hardcoding job logic."
    >
      <div className="rounded-lg border border-[#262629] bg-[#141416] p-6 text-sm text-[#9ca0a8]">
        Campaign grants, free model quotas, eligibility rules, and usage caps will live here.
      </div>
    </PageSection>
  );
}
