import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges conditional Tailwind class names, resolving conflicts.
 *
 * Purpose: shadcn/ui-style class combiner used across all components.
 * `clsx` flattens the inputs (strings, arrays, objects with truthy
 * values) and `tailwind-merge` drops earlier classes that a later class
 * overrides (e.g. `cn("px-2", isWide && "px-4")` → `"px-4"`).
 *
 * @param inputs Tailwind class values: strings, arrays, or
 *   `{ [className]: boolean }` records; falsy entries are skipped.
 * @returns A single deduplicated class-name string safe for `className`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
