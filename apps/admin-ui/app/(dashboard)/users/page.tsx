import { PageSection } from "@/components/page-section";

export default function UsersPage() {
  return (
    <PageSection
      eyebrow="Users"
      title="User operations"
      description="Search users, review workspace memberships, inspect entitlements, and diagnose payment or generation issues."
    >
      <div className="rounded-lg border border-[#262629] bg-[#141416] p-6 text-sm text-[#9ca0a8]">
        User search, workspace overview, entitlement diagnostics, and payment support tools will
        live here.
      </div>
    </PageSection>
  );
}
