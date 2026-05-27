import { PageSection } from "@/components/page-section";
import { Card, CardContent } from "@/components/ui/card";

export default function UsersPage() {
  return (
    <PageSection
      eyebrow="Users"
      title="User operations"
      description="Search users, review workspace memberships, inspect entitlements, and diagnose payment or generation issues."
    >
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          User search, workspace overview, entitlement diagnostics, and payment support tools will
          live here.
        </CardContent>
      </Card>
    </PageSection>
  );
}
