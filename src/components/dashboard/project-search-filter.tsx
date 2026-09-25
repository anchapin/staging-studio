"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StatusFilter, SortField, SortOrder } from "@/lib/project-filter";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All Projects" },
  { value: "staged", label: "Staged" },
  { value: "not-staged", label: "Not Staged" },
];

const SORT_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: "updatedAt", label: "Last Updated" },
  { value: "createdAt", label: "Date Created" },
  { value: "propertyAddress", label: "Address" },
  { value: "clientName", label: "Client Name" },
];

interface ProjectSearchFilterProps {
  defaultQuery?: string;
  defaultStatus?: StatusFilter;
  defaultSortField?: SortField;
  defaultSortOrder?: SortOrder;
}

export function ProjectSearchFilter({
  defaultQuery = "",
  defaultStatus = "all",
  defaultSortField = "updatedAt",
  defaultSortOrder = "desc",
}: ProjectSearchFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(defaultQuery);
  const [status, setStatus] = useState<StatusFilter>(defaultStatus);
  const [sortField, setSortField] = useState<SortField>(defaultSortField);
  const [sortOrder, setSortOrder] = useState<SortOrder>(defaultSortOrder);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const updateURL = useCallback(
    (newQuery: string, newStatus: StatusFilter, newSortField: SortField, newSortOrder: SortOrder) => {
      const params = new URLSearchParams();
      if (newQuery) params.set("q", newQuery);
      if (newStatus !== "all") params.set("status", newStatus);
      if (newSortField !== "updatedAt") params.set("sort", newSortField);
      if (newSortOrder !== "desc") params.set("order", newSortOrder);
      const queryString = params.toString();
      router.push(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    },
    [pathname, router]
  );

  useEffect(() => {
    const q = searchParams.get("q") ?? "";
    const s = (searchParams.get("status") as StatusFilter) ?? "all";
    const sf = (searchParams.get("sort") as SortField) ?? "updatedAt";
    const so = (searchParams.get("order") as SortOrder) ?? "desc";
    setQuery(q);
    setStatus(s);
    setSortField(sf);
    setSortOrder(so);
  }, [searchParams]);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setQuery(newQuery);
    updateURL(newQuery, status, sortField, sortOrder);
  };

  const handleStatusChange = (value: string | null) => {
    if (!value) return;
    const v = value as StatusFilter;
    setStatus(v);
    updateURL(query, v, sortField, sortOrder);
  };

  const handleSortFieldChange = (value: string | null) => {
    if (!value) return;
    const v = value as SortField;
    setSortField(v);
    updateURL(query, status, v, sortOrder);
  };

  const handleSortOrderChange = (value: string | null) => {
    if (!value) return;
    const v = value as SortOrder;
    setSortOrder(v);
    updateURL(query, status, sortField, v);
  };

  const clearFilters = () => {
    setQuery("");
    setStatus("all");
    setSortField("updatedAt");
    setSortOrder("desc");
    router.push(pathname, { scroll: false });
  };

  const hasActiveFilters =
    query !== "" || status !== "all" || sortField !== "updatedAt" || sortOrder !== "desc";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by address, client, or aesthetic..."
            value={query}
            onChange={handleQueryChange}
            className="pl-9"
          />
        </div>
        <button
          type="button"
          onClick={() => setIsFilterOpen(!isFilterOpen)}
          className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors ${
            isFilterOpen || hasActiveFilters
              ? "border-ring bg-accent text-foreground"
              : "border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
          aria-label="Toggle filters"
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Filters</span>
        </button>
      </div>

      {isFilterOpen && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2">
            <label htmlFor="status-filter" className="text-sm text-muted-foreground">
              Status
            </label>
            <Select value={status} onValueChange={handleStatusChange}>
              <SelectTrigger id="status-filter" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="sort-field" className="text-sm text-muted-foreground">
              Sort by
            </label>
            <Select value={sortField} onValueChange={handleSortFieldChange}>
              <SelectTrigger id="sort-field" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="sort-order" className="text-sm text-muted-foreground">
              Order
            </label>
            <Select value={sortOrder} onValueChange={handleSortOrderChange}>
              <SelectTrigger id="sort-order" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Descending</SelectItem>
                <SelectItem value="asc">Ascending</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto flex h-7 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
