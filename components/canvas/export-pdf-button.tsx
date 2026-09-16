"use client";

import { useState, useCallback } from "react";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { Loader2, FileText } from "lucide-react";

interface ExportPdfButtonProps {
  projectId: string;
  projectName?: string;
  onExportStart?: () => void;
  onExportComplete?: () => void;
}

export default function ExportPdfButton({
  projectId,
  projectName,
  onExportStart,
  onExportComplete,
}: ExportPdfButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const { toasts, showError, showSuccess, dismissToast } = useToast();

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    onExportStart?.();

    try {
      const response = await fetch("/api/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || data.error || "Failed to export PDF");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectName || `project-${projectId}`}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      showSuccess("PDF exported successfully!");
      onExportComplete?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to export PDF";
      showError(message, true, () => {
        handleExport();
      });
    } finally {
      setIsExporting(false);
    }
  }, [projectId, projectName, onExportStart, onExportComplete, showError, showSuccess]);

  return (
    <div>
      <button
        onClick={handleExport}
        disabled={isExporting}
        className={`
          flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
          transition-colors
          ${isExporting
            ? "bg-stone-300 text-stone-500 cursor-not-allowed"
            : "bg-stone-800 text-white hover:bg-stone-700"
          }
        `}
      >
        {isExporting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Exporting...
          </>
        ) : (
          <>
            <FileText className="w-4 h-4" />
            Export PDF
          </>
        )}
      </button>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
