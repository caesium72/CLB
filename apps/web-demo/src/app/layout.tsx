import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
const title = "CLB-ACEL Demo";
const description =
  "Cross-Layer Binding inside an Agentic Commerce Evidence Layer — ERC-8004 identity, AP2 " +
  "authorization, and x402 settlement bound into one verifiable commitment, recorded on Base Sepolia.";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  robots: { index: false, follow: false },
  title: { default: title, template: "%s · CLB-ACEL" },
  description,
  applicationName: title,
  openGraph: {
    type: "website",
    url: "/",
    siteName: title,
    title,
    description,
    images: [
      {
        url: "/thumbnail.png",
        width: 1731,
        height: 909,
        alt: "CLB-ACEL — Cross-Layer Binding inside an Agentic Commerce Evidence Layer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/thumbnail.png"],
  },
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-dvh overflow-hidden antialiased`}
    >
      <body className="h-dvh overflow-hidden font-sans">{children}</body>
    </html>
  );
}
