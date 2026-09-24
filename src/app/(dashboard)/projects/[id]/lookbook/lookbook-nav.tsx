"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PreviewRoom } from "@/app/(print)/preview/[id]/lookbook-preview-view";

interface LookbookNavProps {
  coverLabel?: string;
  philosophyLabel?: string;
  swatchesLabel?: string;
  closingLabel?: string;
  rooms: Pick<PreviewRoom, "id" | "name">[];
  hasSwatches?: boolean;
}

type SectionId = "cover" | "philosophy" | "swatches" | "closing" | `room-${string}`;

interface NavItem {
  id: SectionId;
  label: string;
}

export function LookbookNav({
  coverLabel = "Cover",
  philosophyLabel = "Philosophy",
  swatchesLabel = "Swatches",
  closingLabel = "Closing",
  rooms,
  hasSwatches = false,
}: LookbookNavProps) {
  const [activeId, setActiveId] = useState<SectionId | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const roomItems: NavItem[] = rooms.map((r) => ({
    id: `room-${r.id}` as SectionId,
    label: r.name,
  }));

  const navItems: NavItem[] = [
    { id: "cover", label: coverLabel },
    { id: "philosophy", label: philosophyLabel },
    ...(hasSwatches ? [{ id: "swatches" as SectionId, label: swatchesLabel }] : []),
    ...roomItems,
    { id: "closing", label: closingLabel },
  ];

  const scrollToSection = useCallback((id: SectionId) => {
    const target = document.getElementById(`lookbook-${id}`);
    if (!target) return;

    const targetTop = target.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({
      top: targetTop - 80,
      behavior: "smooth",
    });
    setActiveId(id);
  }, []);

  useEffect(() => {
    const sectionIds: SectionId[] = [
      "cover",
      "philosophy",
      ...(hasSwatches ? (["swatches"] as SectionId[]) : []),
      ...rooms.map((r) => `room-${r.id}` as const),
      "closing",
    ];

    const sections = sectionIds
      .map((id) => document.getElementById(`lookbook-${id}`))
      .filter(Boolean) as HTMLElement[];

    if (sections.length === 0) return;

    const offset = 80;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => {
            const aTop = a.boundingClientRect.top;
            const bTop = b.boundingClientRect.top;
            return aTop - bTop;
          });

        if (visible.length > 0) {
          const topEntry = visible[0];
          const id = sectionIds.find(
            (sid) => `lookbook-${sid}` === topEntry.target.id
          );
          if (id) setActiveId(id);
        }
      },
      {
        rootMargin: `-${offset}px 0px -${window.innerHeight - offset - 1}px 0px`,
        threshold: 0,
      }
    );

    sections.forEach((section) => observerRef.current?.observe(section));

    return () => {
      observerRef.current?.disconnect();
    };
  }, [rooms, hasSwatches]);

  return (
    <nav
      aria-label="Lookbook sections"
      className="no-print mb-4 flex flex-wrap gap-1 rounded-lg border border-stone-200 bg-white p-2"
    >
      {navItems.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => scrollToSection(item.id)}
          className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
            activeId === item.id
              ? "bg-stone-800 text-white"
              : "text-stone-600 hover:bg-stone-100 hover:text-stone-800"
          }`}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
