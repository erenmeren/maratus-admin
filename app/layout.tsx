import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

// Gabarito (OFL, see app/fonts/OFL.txt): headings, page titles and metric
// figures. Served from the app itself, not from Google.
const display = localFont({
  src: "./fonts/gabarito-latin-wght.woff2",
  variable: "--font-display",
  weight: "400 900",
  display: "swap",
  fallback: ["Geist", "system-ui", "sans-serif"],
});

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Maratus Console",
  description:
    "Maratus console: manage screens, stores, and triggered content.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // data-ground: "orange" (ground light + glass panels) or "off" (plain
    // monochrome). The one switch for both; see the top of app/globals.css.
    <html
      lang="en"
      data-ground="orange"
      suppressHydrationWarning
      className={cn("font-sans", geist.variable)}
    >
      <body
        className={`${geist.variable} ${display.variable} ${mono.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
