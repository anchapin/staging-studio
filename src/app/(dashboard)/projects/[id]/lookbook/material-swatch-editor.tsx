"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Check, X } from "lucide-react";
import { saveMaterialSwatch, deleteMaterialSwatch } from "@/app/actions/material-swatch";
import type { MaterialSwatchData } from "@/components/lookbook";

interface MaterialSwatchEditorProps {
  projectId: string;
  swatches: MaterialSwatchData[];
}

type SwatchDraft = {
  name: string;
  hexCode: string;
  materialType: string;
  useCase: string;
  vendor?: string;
  sku?: string;
};

const MATERIAL_TYPES = [
  "Hardwood",
  "Laminate",
  "Tile",
  "Carpet",
  "Stone",
  "Metal",
  "Fabric",
  "Leather",
  "Glass",
  "Latex",
  "Paint",
  "Wallpaper",
  "Other",
];

const USE_CASES = [
  "Flooring",
  "Walls",
  "Ceiling",
  "Cabinetry",
  "Countertops",
  "Hardware",
  "Textile",
  "Lighting",
  "Decor",
  "Exterior",
  "Other",
];

const DEFAULT_DRAFT: SwatchDraft = {
  name: "",
  hexCode: "#C8A882",
  materialType: "Hardwood",
  useCase: "Flooring",
};

function isValidHex(hex: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

function HexColorInput({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        id={id}
        value={value}
        onChange={(e) => {
          setLocal(e.target.value);
          onChange(e.target.value.toUpperCase());
        }}
        className="w-10 h-8 rounded border border-stone-300 cursor-pointer bg-transparent"
        aria-label="Color picker"
      />
      <input
        type="text"
        id={`${id}-hex`}
        value={local}
        onChange={(e) => {
          const v = e.target.value;
          setLocal(v);
          if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) {
            onChange(v);
          }
        }}
        onBlur={() => {
          if (!isValidHex(local)) {
            setLocal(value);
          }
        }}
        maxLength={7}
        className="w-24 rounded-md border border-stone-300 px-2 py-1.5 text-sm font-mono focus:border-stone-500 focus:outline-none"
        placeholder="#C8A882"
        aria-label="Hex color code"
      />
    </div>
  );
}

interface SwatchRowProps {
  swatch: MaterialSwatchData;
  projectId: string;
  onDelete: (id: string) => void;
}

function SwatchRow({ swatch, projectId, onDelete }: SwatchRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SwatchDraft>({
    name: swatch.name,
    hexCode: swatch.hexCode,
    materialType: swatch.materialType,
    useCase: swatch.useCase,
    vendor: swatch.vendor ?? undefined,
    sku: swatch.sku ?? undefined,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!draft.name.trim() || !isValidHex(draft.hexCode)) return;
    setSaving(true);
    setError(null);
    const result = await saveMaterialSwatch(projectId, {
      id: swatch.id,
      ...draft,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error ?? "Failed to save");
    } else {
      setEditing(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    const result = await deleteMaterialSwatch(projectId, swatch.id);
    if (!result.success) {
      setError(result.error ?? "Failed to delete");
      setDeleting(false);
    } else {
      onDelete(swatch.id);
    }
  };

  if (editing) {
    return (
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-stone-300 bg-white p-4">
        {/* Color picker */}
        <div className="space-y-1">
          <label htmlFor="swatch-color" className="block text-xs font-medium text-stone-600">Color</label>
          <HexColorInput
            id="swatch-color"
            value={draft.hexCode}
            onChange={(v) => setDraft((d) => ({ ...d, hexCode: v }))}
          />
        </div>

        {/* Name */}
        <div className="space-y-1">
          <label htmlFor="swatch-name" className="block text-xs font-medium text-stone-600">Name</label>
          <input
            id="swatch-name"
            type="text"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            maxLength={100}
            className="w-36 rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
            placeholder="White Oak"
          />
        </div>

        {/* Material type */}
        <div className="space-y-1">
          <label htmlFor="swatch-material" className="block text-xs font-medium text-stone-600">Material</label>
          <select
            id="swatch-material"
            value={draft.materialType}
            onChange={(e) => setDraft((d) => ({ ...d, materialType: e.target.value }))}
            className="rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
          >
            {MATERIAL_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Use case */}
        <div className="space-y-1">
          <label htmlFor="swatch-usecase" className="block text-xs font-medium text-stone-600">Use case</label>
          <select
            id="swatch-usecase"
            value={draft.useCase}
            onChange={(e) => setDraft((d) => ({ ...d, useCase: e.target.value }))}
            className="rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
          >
            {USE_CASES.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        {/* Vendor */}
        <div className="space-y-1">
          <label htmlFor="swatch-vendor" className="block text-xs font-medium text-stone-600">Vendor</label>
          <input
            id="swatch-vendor"
            type="text"
            value={draft.vendor ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, vendor: e.target.value || undefined }))}
            maxLength={100}
            className="w-28 rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
            placeholder="Wayfair"
          />
        </div>

        {/* SKU */}
        <div className="space-y-1">
          <label htmlFor="swatch-sku" className="block text-xs font-medium text-stone-600">SKU</label>
          <input
            id="swatch-sku"
            type="text"
            value={draft.sku ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, sku: e.target.value || undefined }))}
            maxLength={100}
            className="w-28 rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
            placeholder="WF-HW-1234"
          />
        </div>

          {/* Actions */}
          <div className="flex items-center gap-1 self-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !draft.name.trim() || !isValidHex(draft.hexCode)}
            className="rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft({
                name: swatch.name,
                hexCode: swatch.hexCode,
                materialType: swatch.materialType,
                useCase: swatch.useCase,
                vendor: swatch.vendor ?? undefined,
                sku: swatch.sku ?? undefined,
              });
              setEditing(false);
            }}
            className="rounded-md border border-stone-300 px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {error && <p className="w-full text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white p-4">
      {/* Color preview */}
      <div
        className="h-12 w-12 rounded-lg border border-border flex-shrink-0"
        style={{ backgroundColor: swatch.hexCode }}
        title={swatch.hexCode}
      />

      <div className="flex-1 min-w-0">
        <p className="font-playfair text-sm font-semibold text-stone-800 truncate">
          {swatch.name}
        </p>
        <p className="font-jakarta text-xs text-muted-foreground">
          {swatch.materialType} · {swatch.useCase}
          {swatch.vendor && ` · ${swatch.vendor}`}
        </p>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="font-mono text-xs text-stone-500">{swatch.hexCode}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md border border-stone-300 px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-md border border-stone-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function MaterialSwatchEditor({ projectId, swatches: initialSwatches }: MaterialSwatchEditorProps) {
  const [swatches, setSwatches] = useState<MaterialSwatchData[]>(initialSwatches);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<SwatchDraft>(DEFAULT_DRAFT);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleAdd = async () => {
    if (!draft.name.trim() || !isValidHex(draft.hexCode)) return;
    setSaving(true);
    setAddError(null);
    const result = await saveMaterialSwatch(projectId, { ...draft });
    setSaving(false);
    if (result.success && result.id) {
      setSwatches((prev) => [...prev, { id: result.id!, ...draft }]);
      setDraft(DEFAULT_DRAFT);
      setShowAdd(false);
    } else {
      setAddError(result.error ?? "Failed to add swatch");
    }
  };

  const handleDelete = (id: string) => {
    startTransition(() => {
      setSwatches((prev) => prev.filter((s) => s.id !== id));
    });
  };

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-playfair text-xl font-bold text-stone-800">
            Material Swatches
          </h3>
          <p className="font-jakarta text-sm text-muted-foreground mt-0.5">
            Finish and palette references for the lookbook
          </p>
        </div>
        {!showAdd && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 rounded-md bg-stone-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-stone-700"
          >
            <Plus className="h-4 w-4" />
            Add Swatch
          </button>
        )}
      </div>

      {/* Existing swatches */}
      {swatches.length === 0 && !showAdd ? (
        <p className="py-6 text-center font-jakarta text-sm text-stone-400">
          No material swatches yet. Add your first swatch above.
        </p>
      ) : (
        <div className="space-y-3">
          {swatches.map((swatch) => (
            <SwatchRow
              key={swatch.id}
              swatch={swatch}
              projectId={projectId}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Add swatch form */}
      {showAdd && (
        <div className="mt-4 space-y-4 rounded-lg border border-stone-300 bg-stone-50 p-4">
          <p className="font-medium text-stone-700 text-sm">New Swatch</p>

          <div className="flex flex-wrap items-end gap-3">
            {/* Color */}
            <div className="space-y-1">
              <label htmlFor="add-swatch-color" className="block text-xs font-medium text-stone-600">Color</label>
              <HexColorInput
                id="add-swatch-color"
                value={draft.hexCode}
                onChange={(v) => setDraft((d) => ({ ...d, hexCode: v }))}
              />
            </div>

            {/* Name */}
            <div className="space-y-1">
              <label htmlFor="add-swatch-name" className="block text-xs font-medium text-stone-600">Name</label>
              <input
                id="add-swatch-name"
                type="text"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                maxLength={100}
                className="w-36 rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
                placeholder="White Oak"
              />
            </div>

            {/* Material type */}
            <div className="space-y-1">
              <label htmlFor="add-swatch-material" className="block text-xs font-medium text-stone-600">Material</label>
              <select
                id="add-swatch-material"
                value={draft.materialType}
                onChange={(e) => setDraft((d) => ({ ...d, materialType: e.target.value }))}
                className="rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
              >
                {MATERIAL_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {/* Use case */}
            <div className="space-y-1">
              <label htmlFor="add-swatch-usecase" className="block text-xs font-medium text-stone-600">Use case</label>
              <select
                id="add-swatch-usecase"
                value={draft.useCase}
                onChange={(e) => setDraft((d) => ({ ...d, useCase: e.target.value }))}
                className="rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
              >
                {USE_CASES.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>

            {/* Vendor */}
            <div className="space-y-1">
              <label htmlFor="add-swatch-vendor" className="block text-xs font-medium text-stone-600">Vendor</label>
              <input
                id="add-swatch-vendor"
                type="text"
                value={draft.vendor ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, vendor: e.target.value || undefined }))}
                maxLength={100}
                className="w-28 rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
                placeholder="Wayfair"
              />
            </div>

            {/* SKU */}
            <div className="space-y-1">
              <label htmlFor="add-swatch-sku" className="block text-xs font-medium text-stone-600">SKU</label>
              <input
                id="add-swatch-sku"
                type="text"
                value={draft.sku ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, sku: e.target.value || undefined }))}
                maxLength={100}
                className="w-28 rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
                placeholder="WF-HW-1234"
              />
            </div>
          </div>

        {addError && <p className="text-xs text-red-700">{addError}</p>}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving || !draft.name.trim() || !isValidHex(draft.hexCode)}
              className="rounded-md bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
            >
              {saving ? "Adding…" : "Add Swatch"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(DEFAULT_DRAFT);
                setShowAdd(false);
                setAddError(null);
              }}
              className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
