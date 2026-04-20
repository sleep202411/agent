export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
