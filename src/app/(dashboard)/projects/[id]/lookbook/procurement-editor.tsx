"use client";

import { FurnitureProcurementTable } from "@/components/lookbook/furniture-procurement-table";
import type { ProcurementItemDisplay } from "@/components/lookbook/furniture-procurement-table";
import type { ProcurementItemInput } from "@/app/actions/procurement";

interface ProcurementTableEditorProps {
  items: ProcurementItemInput[];
  onChange: (items: ProcurementItemInput[]) => void;
}

/**
 * Editable procurement table with autosave.
 */
export function ProcurementTableEditor({ items, onChange }: ProcurementTableEditorProps) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-playfair text-xl font-bold text-stone-800">
          Furniture Procurement
        </h2>
      </div>
      <FurnitureProcurementTable
        items={items as unknown as ProcurementItemDisplay[]}
        editable
        onChange={onChange}
      />
    </section>
  );
}
