"use client";

/**
 * Proposal Footer with Atelier Canvas branding (issue #643).
 * Appears at the bottom of every Client Consultation Report page
 * and in the PDF export via `@page { @bottom-center }`.
 */

interface ProposalFooterProps {
  /** Optional page number for PDF export, e.g. "Page 1 of 12" */
  pageNumber?: string;
}

export function ProposalFooter({ pageNumber }: ProposalFooterProps) {
  return (
    <footer className="proposal-footer print:proposal-footer-print">
      {/* Hairline border divider */}
      <div className="border-t border-border/30" />

      <div className="flex items-start justify-between gap-4 py-4 px-0">
        {/* Left: Atelier Canvas wordmark + tagline */}
        <div className="space-y-0.5">
          <p className="font-playfair text-base leading-none">
            <span className="italic text-[#C47847]">Atelier</span>
            <span className="text-[#181716]"> Canvas</span>
          </p>
          <p className="font-jakarta text-xs text-muted-foreground">
            AI-Powered Home Staging
          </p>
        </div>

        {/* Center: Page number (PDF export) */}
        {pageNumber && (
          <p className="font-jakarta text-xs text-muted-foreground hidden print:block">
            {pageNumber}
          </p>
        )}

        {/* Right: copyright, AI watermark, legal links */}
        <div className="text-right space-y-0.5">
          <p className="font-jakarta text-xs text-foreground">
            &copy; 2026 Circle G Designs &middot; Staging Studio
          </p>
          <p className="font-jakarta text-xs text-muted-foreground">
            All renders retain AI watermark
          </p>
          <p className="font-jakarta text-xs text-secondary">
            <button
              type="button"
              className="hover:underline underline-offset-2"
            >
              Policy
            </button>
            <span className="mx-1">&middot;</span>
            <button
              type="button"
              className="hover:underline underline-offset-2"
            >
              Privacy
            </button>
            <span className="mx-1">&middot;</span>
            <button
              type="button"
              className="hover:underline underline-offset-2"
            >
              Terms
            </button>
          </p>
        </div>
      </div>
    </footer>
  );
}
