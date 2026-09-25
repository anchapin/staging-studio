"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Cinzel, Playfair_Display, Plus_Jakarta_Sans } from "next/font/google";
import { cn } from "@/lib/utils";
import "./globals.css";

// global-error.tsx replaces the root layout when it renders, so the fonts
// and globals.css loaded there are NOT in scope — re-declare them here so
// the branded font-* Tailwind classes still resolve (issue #89).
const cinzel = Cinzel({
  subsets: ["latin"],
  variable: "--font-cinzel",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Capture error with Sentry for production monitoring
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      Sentry.captureException(error, {
        extra: { digest: error.digest },
      });
    }
    console.error(
      `[app:error] Unhandled application error${error.digest ? ` (digest: ${error.digest})` : ""}`,
      error,
    );
  }, [error]);

  return (
    <html
      lang="en"
      className={cn(
        cinzel.variable,
        playfair.variable,
        plusJakarta.variable,
        "font-sans",
      )}
    >
      <body className="antialiased">
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200 px-4">
          <div className="w-full max-w-md space-y-6 rounded-xl bg-white p-8 text-center shadow-xl">
            <div>
              <h1 className="font-cinzel text-3xl font-bold tracking-tight text-stone-800">
                StagingStudio
              </h1>
              <p className="mt-2 font-playfair text-sm text-stone-600">
                AI-Assisted Home Staging Lookbooks
              </p>
            </div>

            <div
              role="alert"
              tabIndex={-1}
              className="rounded-md bg-red-50 p-3 text-sm text-red-700"
            >
              Something went wrong on our end. Please try again.
              {error.digest && (
                <span className="mt-1 block text-xs text-stone-500">
                  Reference: {error.digest}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={reset}
              className="w-full rounded-md bg-stone-800 py-2.5 font-medium text-white transition-colors hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2"
            >
              Try again
            </button>

            <p className="text-center text-xs text-stone-500">
              For Circle G Designs — Lauren Chapin
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
