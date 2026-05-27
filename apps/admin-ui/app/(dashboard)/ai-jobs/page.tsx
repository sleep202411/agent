import { PageSection } from "@/components/page-section";

export default function AiJobsPage() {
  return (
    <PageSection
      eyebrow="AI Jobs"
      title="Generation job operations"
      description="Monitor queued, running, failed, retried, and settled AI jobs across model products and providers."
    >
      <div className="rounded-lg border border-[#262629] bg-[#141416] p-6 text-sm text-[#9ca0a8]">
        Job table, provider health, queue controls, retry actions, and cost settlement records will
        live here.
      </div>
    </PageSection>
  );
}
