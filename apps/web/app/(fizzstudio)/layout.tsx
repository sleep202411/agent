import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FizzStudio",
  description: "A product preview for the next FizzDragon creator workspace.",
};

export default function FizzStudioLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#050608] text-white">{children}</div>;
}
