import type { Metadata, Viewport } from "next";
import { Manrope, Space_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "RabbitTech Logistics",
    template: "%s | RabbitTech Logistics",
  },
  description: "Uber for Trucks — Multi-truck load booking platform",
  applicationName: "RabbitTech Logistics",
  manifest: "/manifest.webmanifest",
  formatDetection: {
    email: false,
    telephone: false,
    address: false,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "RabbitTech",
  },
};

export const viewport: Viewport = {
  themeColor: "#081121",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${spaceMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full bg-[var(--app-bg)] text-[var(--app-foreground)]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
