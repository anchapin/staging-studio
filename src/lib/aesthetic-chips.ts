const AESTHETIC_CHIPS: Record<string, string[]> = {
  "Organic Modern Luxury": [
    "Neutral linen sofa",
    "Light oak accents",
    "Organic textured rug",
    "Sculptural lighting",
  ],
  "Warm Transitional": [
    "Classic wooden dining set",
    "Cozy upholstered chairs",
    "Neutral area rug",
    "Traditional brass accents",
  ],
  "Coastal Minimal": [
    "Light oak console table",
    "White linen sofa",
    "Natural woven rug",
    "Blue and white accents",
  ],
  "Urban Industrial": [
    "Metal and wood table",
    "Leather accent chair",
    "Exposed bulb lighting",
    "Concrete textured rug",
  ],
  "Classic Elegant": [
    "Tufted velvet sofa",
    "Ornate wooden frames",
    "Crystal chandelier",
    "Rich silk drapes",
  ],
};

const GENERIC_CHIPS = [
  "Modern sofa",
  "Wooden coffee table",
  "Area rug",
  "Floor lamp",
];

export function getAestheticChips(aesthetic: string): string[] {
  const trimmed = aesthetic?.trim() ?? "";
  if (!trimmed) return GENERIC_CHIPS;
  return AESTHETIC_CHIPS[trimmed] ?? GENERIC_CHIPS;
}
