"use client";

import { useState, useMemo } from "react";

export interface ProcurementItemDisplay {
  id?: string;
  item: string;
  category: string;
  vendor: string | null;
  sku: string | null;
  estCost: number | null;
  status?: string;
}

interface FurnitureProcurementTableProps {
  items: ProcurementItemDisplay[];
  /** When true, renders inline editors instead of plain text. */
  editable?: boolean;
  /** Called with the full updated list when editable and user commits a change. */
  onChange?: (items: ProcurementItemDisplay[]) => void;
}

type SortKey = "item" | "category" | "vendor" | "sku" | "estCost";
type SortDir = "asc" | "desc";

const CATEGORIES = [
  "Seating",
  "Tables",
  "Beds",
  "Storage",
  "Lighting",
  "Rugs",
  "Flooring",
  "Decor",
  "Art",
  "Window Treatments",
  "Outdoor",
  "Other",
];

function formatCost(cost: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cost);
}

function downloadCSV(items: ProcurementItemDisplay[]) {
  const headers = ["Item", "Category", "Vendor", "SKU", "Est. Cost"];
  const rows = items.map((i) => [
    i.item,
    i.category,
    i.vendor ?? "",
    i.sku ?? "",
    (i.estCost ?? 0).toFixed(2),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "furniture-procurement.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function FurnitureProcurementTable({
  items,
  editable = false,
  onChange,
}: FurnitureProcurementTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("item");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [editingItems, setEditingItems] = useState<ProcurementItemDisplay[]>(items);

  // Sync editing items when prop changes (e.g., after save)
  if (!editable && items !== editingItems && JSON.stringify(items) !== JSON.stringify(editingItems)) {
    setEditingItems(items);
  }

  const categories = useMemo(() => {
    const cats = new Set(items.map((i) => i.category));
    return Array.from(cats).sort();
  }, [items]);

  const filtered = useMemo(() => {
    let list = editable ? editingItems : items;
    if (activeCategory) {
      list = list.filter((i) => i.category === activeCategory);
    }
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, editingItems, editable, activeCategory, sortKey, sortDir]);

  const total = useMemo(
    () => filtered.reduce((sum, i) => sum + (i.estCost ?? 0), 0),
    [filtered]
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const editItem = (index: number, patch: Partial<ProcurementItemDisplay>) => {
    const updated = editingItems.map((item, i) =>
      i === index ? { ...item, ...patch } : item
    );
    setEditingItems(updated);
    onChange?.(updated);
  };

  const deleteItem = (index: number) => {
    const updated = editingItems.filter((_, i) => i !== index);
    setEditingItems(updated);
    onChange?.(updated);
  };

  const addItem = () => {
    const newItem: ProcurementItemDisplay = {
      item: "",
      category: "Seating",
      vendor: "",
      sku: "",
      estCost: 0,
    };
    const updated = [...editingItems, newItem];
    setEditingItems(updated);
    onChange?.(updated);
  };

  return (
    <div className="lookbook-page min-h-screen flex flex-col bg-stone-50">
      <div className="p-8 border-b border-border">
        <div className="flex items-baseline justify-between">
          <h2 className="font-playfair text-3xl font-bold text-foreground">
            Furniture Procurement
          </h2>
          <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground">
            Vendor &amp; SKU Reference
          </p>
        </div>
      </div>

      {/* Category filter chips */}
      {categories.length > 0 && (
        <div className="avoid-break px-8 py-4 bg-white border-b border-border flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={() => setActiveCategory(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeCategory === null
                ? "bg-primary text-white"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200"
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeCategory === cat
                  ? "bg-primary text-white"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="avoid-break flex-1 p-8 bg-white">
        {filtered.length === 0 ? (
          <p className="font-jakarta text-sm text-muted-foreground text-center py-8">
            No procurement items yet.
            {editable && (
              <button
                type="button"
                onClick={addItem}
                className="ml-2 text-primary hover:underline"
              >
                Add the first item.
              </button>
            )}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200">
                  {(
                    [
                      ["item", "Item"],
                      ["category", "Category"],
                      ["vendor", "Vendor"],
                      ["sku", "SKU"],
                      ["estCost", "Est. Cost"],
                    ] as const
                  ).map(([key, label]) => (
                    <th
                      key={key}
                      className="text-left py-2 pr-4 font-medium text-stone-600 cursor-pointer select-none"
                      onClick={() => toggleSort(key)}
                    >
                      {label}
                      <SortIcon col={key} />
                    </th>
                  ))}
                  {editable && (
                    <th aria-label="Actions" className="w-12" />
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => {
                  const rowIdx = editingItems.indexOf(row);
                  return (
                    <tr
                      key={row.id ?? idx}
                      className="border-b border-stone-100 hover:bg-stone-50"
                    >
                      <td className="py-2 pr-4">
                        {editable ? (
                          <input
                            type="text"
                            value={row.item}
                            aria-label="Item name"
                            onChange={(e) => editItem(rowIdx, { item: e.target.value })}
                            className="w-full rounded border border-stone-300 px-2 py-1 text-sm focus:border-primary focus:outline-none"
                          />
                        ) : (
                          <span className="font-medium text-stone-800">{row.item}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {editable ? (
                          <select
                            value={row.category}
                            aria-label="Category"
                            onChange={(e) => editItem(rowIdx, { category: e.target.value })}
                            className="rounded border border-stone-300 px-2 py-1 text-sm focus:border-primary focus:outline-none"
                          >
                            {CATEGORIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-stone-600">{row.category}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {editable ? (
                          <input
                            type="text"
                            value={row.vendor ?? ""}
                            aria-label="Vendor"
                            onChange={(e) => editItem(rowIdx, { vendor: e.target.value })}
                            className="w-full rounded border border-stone-300 px-2 py-1 text-sm focus:border-primary focus:outline-none"
                          />
                        ) : (
                          <span className="text-stone-600">{row.vendor ?? "—"}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {editable ? (
                          <input
                            type="text"
                            value={row.sku ?? ""}
                            aria-label="SKU"
                            onChange={(e) => editItem(rowIdx, { sku: e.target.value })}
                            className="w-full rounded border border-stone-300 px-2 py-1 text-sm focus:border-primary focus:outline-none"
                          />
                        ) : (
                          <span className="font-mono text-xs text-stone-500">{row.sku ?? "—"}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {editable ? (
                          <input
                            type="number"
                            value={row.estCost ?? ""}
                            aria-label="Estimated cost"
                            min={0}
                            step={1}
                            onChange={(e) =>
                              editItem(rowIdx, { estCost: parseFloat(e.target.value) || 0 })
                            }
                            className="w-28 rounded border border-stone-300 px-2 py-1 text-sm focus:border-primary focus:outline-none"
                          />
                        ) : (
                          <span className="font-medium text-stone-800">
                            {formatCost(row.estCost ?? 0)}
                          </span>
                        )}
                      </td>
                      {editable && (
                        <td className="py-2">
                          <button
                            type="button"
                            aria-label="Delete item"
                            onClick={() => deleteItem(rowIdx)}
                            className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-stone-300">
                  <td colSpan={4} className="pt-3 pr-4 text-right">
                    <span className="font-medium text-stone-700">
                      {activeCategory ? "Category Total" : "Grand Total"}
                    </span>
                  </td>
                  <td className="pt-3">
                    <span className="font-bold text-lg text-stone-900">
                      {formatCost(total)}
                    </span>
                  </td>
                  {editable && <td aria-hidden="true" />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Actions row */}
        <div className="mt-4 flex items-center justify-between">
          {editable ? (
            <button
              type="button"
              onClick={addItem}
              className="rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary/90"
            >
              + Add Item
            </button>
          ) : (
            <div />
          )}

          {filtered.length > 0 && (
            <button
              type="button"
              onClick={() => downloadCSV(editable ? editingItems : items)}
              className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100"
            >
              Export CSV
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
