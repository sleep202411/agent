type PageSectionProps = {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
};

export function PageSection({ eyebrow, title, description, children }: PageSectionProps) {
  return (
    <section className="space-y-5">
      <div className="max-w-3xl space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9ca0a8]">
          {eyebrow}
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-white md:text-3xl">
          {title}
        </h1>
        <p className="text-sm leading-6 text-[#9ca0a8]">{description}</p>
      </div>
      {children}
    </section>
  );
}
