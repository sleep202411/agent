import { PageSection } from "@/components/page-section";
import { Card, CardContent } from "@/components/ui/card";

export default function WalletsPage() {
  return (
    <PageSection
      eyebrow="Wallets"
      title="Bubbles and community credits"
      description="Inspect balances, reservations, settlements, refunds, and manual adjustments with full audit trail."
    >
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Wallet lookup, ledger entries, reservations, refunds, and operator adjustment workflows
          will live here.
        </CardContent>
      </Card>
    </PageSection>
  );
}
