"use client";

import type { MaterialSwatchData } from "./types";

const MATERIAL_GRADIENTS: Record<string, string> = {
  linen: "bg-gradient-to-br from-[#F4F1EC] to-[#EDE7DF]",
  plaster: "bg-gradient-to-br from-[#F4F1EC] to-[#EDE7DF]",
  "linen/plaster": "bg-gradient-to-br from-[#F4F1EC] to-[#EDE7DF]",
  travertine: "bg-gradient-to-br from-[#D8C7B5] to-[#C4B49E]",
  "vintage brass": "bg-gradient-to-br from-[#B89B66] to-[#A08550]",
  "vintage-brass": "bg-gradient-to-br from-[#B89B66] to-[#A08550]",
  brass: "bg-gradient-to-br from-[#B89B66] to-[#A08550]",
  "pacific glass": "bg-gradient-to-br from-[#97AFA7] to-[#7A9A8A]",
  glass: "bg-gradient-to-br from-[#97AFA7] to-[#7A9A8A]",
  "textured jute": "bg-gradient-to-br from-[#9A8268] to-[#7A6450]",
  jute: "bg-gradient-to-br from-[#9A8268] to-[#7A6450]",
  oak: "bg-gradient-to-br from-[#C8A882] to-[#A68B5B]",
  "white oak": "bg-gradient-to-br from-[#E8DCC8] to-[#D4C4A8]",
  walnut: "bg-gradient-to-br from-[#5C4033] to-[#3E2B22]",
  marble: "bg-gradient-to-br from-[#F5F5F5] to-[#E0E0E0]",
  "calacatta marble": "bg-gradient-to-br from-[#F8F8F8] to-[#E8E8E8]",
  "emperador marble": "bg-gradient-to-br from-[#6B4423] to-[#4A2F18]",
  "cream linen": "bg-gradient-to-br from-[#FAF5EF] to-[#EDE5DB]",
  wool: "bg-gradient-to-br from-[#E8E4DE] to-[#D5CFC7]",
  cotton: "bg-gradient-to-br from-[#F8F6F2] to-[#EBE7E1]",
  velvet: "bg-gradient-to-br from-[#5C4D6B] to-[#3D3249]",
  "sage velvet": "bg-gradient-to-br from-[#9CAF88] to-[#7A8F66]",
  bouclé: "bg-gradient-to-br from-[#F0EBE3] to-[#E0D6C8]",
  rattan: "bg-gradient-to-br from-[#D4A85C] to-[#B8924E]",
  " cane": "bg-gradient-to-br from-[#D4A85C] to-[#B8924E]",
  concrete: "bg-gradient-to-br from-[#9A9A9A] to-[#787878]",
  terrazzo: "bg-gradient-to-br from-[#E8E0D8] to-[#D4C8BC]",
  ceramic: "bg-gradient-to-br from-[#F0EDE8] to-[#E0DCD4]",
  porcelain: "bg-gradient-to-br from-[#F8F8F8] to-[#ECECEC]",
  stone: "bg-gradient-to-br from-[#A8A29E] to-[#8D8D8D]",
  slate: "bg-gradient-to-br from-[#646664] to-[#4A4A4A]",
  "soapstone": "bg-gradient-to-br from-[#E8E6E2] to-[#D4D2CC]",
};

function getGradientForMaterial(name: string): string {
  const normalized = name.toLowerCase().trim();
  if (MATERIAL_GRADIENTS[normalized]) {
    return MATERIAL_GRADIENTS[normalized];
  }
  for (const [key, gradient] of Object.entries(MATERIAL_GRADIENTS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return gradient;
    }
  }
  return "bg-gradient-to-br from-[#E8E4DE] to-[#D5CFC7]";
}

interface MaterialSwatchCardProps {
  swatch: MaterialSwatchData;
}

export function MaterialSwatchCard({ swatch }: MaterialSwatchCardProps) {
  const gradient = getGradientForMaterial(swatch.name);

  return (
    <div className="flex flex-col items-center gap-2 flex-shrink-0">
      <div
        className={`w-16 h-16 rounded-lg ${gradient} border border-black/5 shadow-sm`}
        aria-hidden="true"
      />
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="font-jakarta text-xs font-semibold text-foreground leading-tight">
          {swatch.name}
        </span>
        <span className="font-jakarta text-[10px] bg-surface-container text-on-surface-variant rounded-full px-2 py-0.5 leading-tight">
          {swatch.materialType}
        </span>
        {swatch.vendor && (
          <span className="font-jakarta text-[10px] text-on-surface-variant leading-tight">
            {swatch.vendor}
          </span>
        )}
      </div>
    </div>
  );
}
