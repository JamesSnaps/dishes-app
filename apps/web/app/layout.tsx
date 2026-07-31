import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/toaster";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { ChunkReloadGuard } from "@/components/chunk-reload-guard";
import { CookSessionProvider } from "@/components/providers/cook-session-provider";
import { CookMiniBar } from "@/components/cook-mini-bar";

export const metadata: Metadata = {
  title: {
    default: "Dishes",
    template: "%s | Dishes",
  },
  description: "Family recipe and meal planning",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "Dishes",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background antialiased">
        <ThemeProvider>
          {/* Above the route tree so a cook survives navigating out of cooking mode */}
          <CookSessionProvider>
            {children}
            <CookMiniBar />
          </CookSessionProvider>
          <Toaster />
          <ServiceWorkerRegistrar />
          <ChunkReloadGuard />
        </ThemeProvider>
      </body>
    </html>
  );
}
