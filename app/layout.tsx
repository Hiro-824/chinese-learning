import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chess",
  description: "コンピューターと遊べるチェス",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
