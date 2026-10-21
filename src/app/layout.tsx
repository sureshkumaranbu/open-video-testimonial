import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Plaudit", template: "%s · Plaudit" },
  description: "Collect and share video and text testimonials. Open source and self-hosted.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
