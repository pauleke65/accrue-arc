import type { Metadata, Viewport } from "next";
import { Footer, Header, SettledToast } from "@/components/shell";
import { WalletProvider } from "./wallet";
import "./globals.css";
import { NETWORK_NAME } from "@/lib/arc";

export const metadata: Metadata = {
  title: "Accrue on Arc · Pay for work when it's proven done",
  description:
    "Post an objective with a USDC budget. It's locked on Arc until a panel (Accrue's Proof Engine agent and the people you name) verifies the work, then it pays in under a second. ERC-8183 jobs, ERC-8004 agent identity, USDC gas.",
  metadataBase: new URL(process.env.PUBLIC_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "Accrue on Arc",
    description: `Pay-on-proof jobs settled in USDC on ${NETWORK_NAME}.`,
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#9fd0f8", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Space+Grotesk:wght@300;400;500&family=Space+Mono:wght@400;700&display=swap"
        />
      </head>
      <body>
        <WalletProvider>
          <Header />
          <main className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12 [&:has(>div>.hero)]:pt-0">{children}</main>
          <Footer />
          <SettledToast />
        </WalletProvider>
      </body>
    </html>
  );
}
