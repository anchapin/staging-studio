"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PreviewRoom } from "@/app/(print)/preview/[id]/lookbook-preview-view";

interface LookbookNavProps {
  coverLabel?: string;
  philosophyLabel?: string;
  closingLabel?: string;
  rooms: Pick<PreviewRoom, "id" | "name">[];
}

type SectionId = "cover" | "philosophy" | "closing" | `room-${string}`;

interface NavItem {
  id: SectionId;
  label: string;
}

export function LookbookNav({
  coverLabel = "Cover",
  philosophyLabel = "Philosophy",
  closingLabel = "Closing",
  rooms,
}: LookbookNavProps) {
  const [activeId, setActiveId] = useState<SectionId | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  const roomItems: NavItem[] = rooms.map((r) => ({
    id: `room-${r.id}` as SectionId,
    label: r.name,
  }));

  const navItems: NavItem[] = [
    { id: "cover", label: coverLabel },
    { id: "philosophy", label: philosophyLabel },
    ...roomItems,
    { id: "closing", label: closingLabel },
  ];

  const scrollToSection = useCallback((id: SectionId) => {
    const container = scrollContainerRef.current;
    const target = document.getElementById(`lookbook-${id}`);
    if (!target || !container) return;

    const containerTop = container.getBoundingClientRect().top + container.scrollTop;
    const targetTop = target.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({
      top: targetTop - 80,
      behavior: "smooth",
    });
    setActiveId(id);
  }, []);

  useEffect(() => {
    scrollContainerRef.current = document.getElementById("main-content") as HTMLElement;

    const container = scrollContainerRef.current;
    if (!container) return;

    const sectionIds: SectionId[] = [
      "cover",
      "philosophy",
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
        root: container,
        rootMargin: `-${offset}px 0px -${container.clientHeight - offset - 1}px 0px`,
        threshold: 0,
      }
    );

    sections.forEach((section) => observerRef.current?.observe(section));

    return () => {
      observerRef.current?.disconnect();
    };
  }, [rooms]);

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
