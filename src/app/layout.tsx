import type { Metadata } from "next";
import { Cinzel, Playfair_Display, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import ReviewPanel from "@/components/review-panel";

const cinzel = Cinzel({
  subsets: ["latin"],
  variable: "--font-cinzel-google",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair-google",
  display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta-google",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-google",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "StagingStudio — AI-Assisted Home Staging Lookbooks",
    template: "%s · StagingStudio",
  },
  description:
    "Generate editorial-quality staging lookbooks for real estate listings using AI inpainting and structured copywriting.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
      <html lang="en" className={cn(cinzel.variable, playfair.variable, plusJakarta.variable, jetbrainsMono.variable, "font-sans")}>
      <body className="antialiased">
        {children}
        <ReviewPanel />
      </body>
    </html>
  );
}
