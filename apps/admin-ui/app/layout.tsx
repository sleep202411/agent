import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FizzDragon 管理后台",
  description: "FizzDragon internal operations console",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
