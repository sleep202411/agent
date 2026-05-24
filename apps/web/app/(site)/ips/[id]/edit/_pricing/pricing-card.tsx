"use client";

interface PricingCardProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

export function PricingCard({ icon, title, children }: PricingCardProps) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}
