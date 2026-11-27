import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Landed", template: "%s · Landed" },
  description: "Landed-Amount Check: estimate, compare and reconcile what an overseas supplier actually receives. Illustrative demo; never moves money.",
};

export const viewport: Viewport = { themeColor: "#08090a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
