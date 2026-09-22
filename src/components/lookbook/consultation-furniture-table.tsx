"use client";

import type { PreviewProcurementItem } from "@/app/(print)/preview/[id]/lookbook-preview-view";

interface ConsultationFurnitureTableProps {
  items: PreviewProcurementItem[];
}

function formatCost(cost: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cost);
}

function getLeadTimeFromStatus(status: string | null | undefined): string {
  switch (status?.toLowerCase()) {
    case "received":
      return "Delivered";
    case "ordered":
      return "1 wk";
    case "needed":
    default:
      return "2 wks";
  }
}

export function ConsultationFurnitureTable({ items }: ConsultationFurnitureTableProps) {
  if (items.length === 0) {
    return null;
  }

  const total = items.reduce((sum, item) => sum + (item.estCost ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outline-variant">
              {(["item", "style", "qty", "lead", "cost"] as const).map((col) => (
                <th
                  key={col}
                  className="text-left py-2 pr-4 font-jakarta text-xs font-medium uppercase tracking-wide text-on-surface-variant"
                >
                  {col === "item"
                    ? "Item"
                    : col === "style"
                    ? "Style / Variant"
                    : col === "qty"
                    ? "Qty"
                    : col === "lead"
                    ? "Lead Time"
                    : "Est. Cost"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((row, idx) => (
              <tr
                key={row.id ?? idx}
                className={`border-b border-outline-variant/50 ${
                  idx % 2 === 0 ? "bg-surface-container-low" : "bg-surface-container"
                }`}
              >
                <td className="py-2 pr-4 font-jakarta text-sm text-foreground font-medium">
                  {row.item}
                </td>
                <td className="py-2 pr-4 font-jakarta text-sm text-on-surface-variant">
                  {row.category}
                </td>
                <td className="py-2 pr-4 font-jakarta text-sm text-on-surface-variant text-center">
                  1
                </td>
                <td className="py-2 pr-4 font-jakarta text-sm text-on-surface-variant">
                  {getLeadTimeFromStatus(row.status)}
                </td>
                <td className="py-2 pr-4 font-jakarta text-sm text-foreground font-medium font-mono text-right">
                  {formatCost(row.estCost ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-outline-variant">
              <td
                colSpan={4}
                className="pt-3 pr-4 text-right font-jakarta text-sm font-semibold text-foreground"
              >
                Estimated Total
              </td>
              <td className="pt-3 font-jakarta text-sm font-bold text-foreground font-mono text-right">
                {formatCost(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
