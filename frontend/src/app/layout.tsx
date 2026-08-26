import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import ServiceWorker from "@/components/ServiceWorker";
import { PRODUCT_NAME } from "@/components/Logo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — Smart Energy Meter`,
  description:
    "Live household power monitoring, month-end bill prediction on the Egyptian tiered tariff, and budget-aware appliance recommendations.",
  manifest: "/manifest.json",
  applicationName: PRODUCT_NAME,
  // Tells iOS to launch from the home screen without Safari's chrome. iOS still
  // ignores the manifest's `display` field, so this is the only way to get a
  // standalone launch there.
  appleWebApp: {
    capable: true,
    title: PRODUCT_NAME,
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  // A dashboard is not a search result, and an installed app has no business
  // being indexed.
  robots: { index: false, follow: false },
};

/**
 * `viewport` is its own export in the App Router — themeColor and viewport keys
 * inside `metadata` are ignored with a build warning.
 *
 * `viewportFit: "cover"` lets the page paint into the display cutout area on a
 * phone, which is what stops an installed PWA showing letterboxed bars beside
 * the notch. `maximumScale` is deliberately NOT set: capping zoom breaks
 * pinch-to-zoom for anyone who needs it, and the layout already reflows to
 * 390px without horizontal overflow.
 */
export const viewport: Viewport = {
  themeColor: "#aedcf8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
