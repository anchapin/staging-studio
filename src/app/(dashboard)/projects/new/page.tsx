"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { StagingPackageCard } from "@/components/packages";
import { STAGING_PACKAGES, getStagingPackage } from "@/lib/staging-packages-schema";
import { STAGING_AESTHETICS } from "@/lib/staging-aesthetics";
import { ConsultationActionBar } from "@/components/dashboard/consultation-action-bar";
import { consultationConfigSummary } from "@/lib/consultation-action-bar";

const BUYER_PERSONAS = [
  "young professional couple",
  "growing family",
  "downsizing empty nesters",
  "luxury investor",
  "first-time homebuyer",
  "serial renovator",
];

const ROOM_TYPES = [
  "Primary Bedroom",
  "Secondary Bedroom",
  "Living Room",
  "Dining Room",
  "Kitchen",
  "Bathroom",
  "Home Office",
  "Guest Bedroom",
  "Garage",
  "Laundry Room",
  "Basement",
  "Attic",
  "Entryway",
  "Media Room",
];

// Buyer Demographics options (issue #563)
const BUYER_TYPES = [
  { value: "young_professional", label: "Young Professional" },
  { value: "growing_family", label: "Growing Family" },
  { value: "downsizing_retiree", label: "Downsizing Retiree" },
  { value: "investor", label: "Investor" },
  { value: "luxury_buyer", label: "Luxury Buyer" },
  { value: "first_time_homebuyer", label: "First-Time Homebuyer" },
  { value: "serial_renovator", label: "Serial Renovator" },
] as const;

const DESIGN_PREFERENCES = [
  { value: "contemporary", label: "Contemporary" },
  { value: "traditional", label: "Traditional" },
  { value: "minimalist", label: "Minimalist" },
  { value: "maximalist", label: "Maximalist" },
  { value: "coastal", label: "Coastal" },
  { value: "industrial", label: "Industrial" },
  { value: "midcentury_modern", label: "Mid-Century Modern" },
  { value: "scandinavian", label: "Scandinavian" },
  { value: "bohemian", label: "Bohemian" },
  { value: "transitional", label: "Transitional" },
] as const;

const MUST_HAVE_FEATURES = [
  { value: "home_office", label: "Home Office" },
  { value: "open_plan", label: "Open Plan" },
  { value: "outdoor_space", label: "Outdoor Space" },
  { value: "gourmet_kitchen", label: "Gourmet Kitchen" },
  { value: "master_suite", label: "Master Suite" },
  { value: "smart_home", label: "Smart Home" },
  { value: "energy_efficient", label: "Energy Efficient" },
  { value: "multigenerational", label: "Multigenerational" },
  { value: "home_gym", label: "Home Gym" },
  { value: "pet_friendly", label: "Pet-Friendly" },
] as const;

const SELL_TIMELINES = [
  { value: "under_30_days", label: "Under 30 days" },
  { value: "30_60_days", label: "30 – 60 days" },
  { value: "60_90_days", label: "60 – 90 days" },
  { value: "over_90_days", label: "Over 90 days" },
] as const;

const BUDGET_MIN = 100; // $100k
const BUDGET_MAX = 5000; // $5M

type BuyerType = (typeof BUYER_TYPES)[number]["value"];
type DesignPreference = (typeof DESIGN_PREFERENCES)[number]["value"];
type MustHaveFeature = (typeof MUST_HAVE_FEATURES)[number]["value"];
type SellTimeline = (typeof SELL_TIMELINES)[number]["value"];

interface BuyerDemographics {
  buyerType: BuyerType;
  designPreferences: DesignPreference[];
  budgetMin: number;
  budgetMax: number;
  mustHaveFeatures: MustHaveFeature[];
  sellTimeline: SellTimeline;
}

const DEFAULT_BUYER_DEMOGRAPHICS: BuyerDemographics = {
  buyerType: "young_professional",
  designPreferences: [],
  budgetMin: 300,
  budgetMax: 600,
  mustHaveFeatures: [],
  sellTimeline: "30_60_days",
};

// ─── Dual-range budget slider ───────────────────────────────────────────────

interface BudgetSliderProps {
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  onChangeMin: (v: number) => void;
  onChangeMax: (v: number) => void;
  step?: number;
}

function BudgetSlider({
  min,
  max,
  valueMin,
  valueMax,
  onChangeMin,
  onChangeMax,
  step = 50,
}: BudgetSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const leftPct = ((valueMin - min) / (max - min)) * 100;
  const rightPct = ((valueMax - min) / (max - min)) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-stone-600">
        <span>
          ${valueMin >= 1000 ? `$${(valueMin / 1000).toFixed(0)}M` : `$${valueMin}k`}
        </span>
        <span>
          ${valueMax >= 1000 ? `$${(valueMax / 1000).toFixed(0)}M` : `$${valueMax}k`}
        </span>
      </div>
      <div className="relative h-2" ref={trackRef}>
        {/* Track background */}
        <div className="absolute inset-0 rounded-full bg-stone-200" />
        {/* Active range */}
        <div
          className="absolute top-0 h-full rounded-full bg-stone-800"
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
        />
        {/* Min thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueMin}
          onChange={(e) => {
            const v = Math.min(Number(e.target.value), valueMax - step);
            onChangeMin(v);
          }}
          className="absolute inset-0 w-full appearance-none bg-transparent cursor-pointer thumb-range"
          aria-label="Minimum budget"
        />
        {/* Max thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueMax}
          onChange={(e) => {
            const v = Math.max(Number(e.target.value), valueMin + step);
            onChangeMax(v);
          }}
          className="absolute inset-0 w-full appearance-none bg-transparent cursor-pointer thumb-range"
          aria-label="Maximum budget"
        />
      </div>
      <style>{`
        .thumb-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--primary);
          border: 2px solid #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          cursor: pointer;
        }
        .thumb-range::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--primary);
          border: 2px solid #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

// ─── Chip toggle ────────────────────────────────────────────────────────────

interface ChipToggleProps<T extends string> {
  options: readonly { value: T; label: string }[];
  selected: T[];
  onChange: (selected: T[]) => void;
}

function ChipToggle<T extends string>({
  options,
  selected,
  onChange,
}: ChipToggleProps<T>) {
  const toggle = (value: T) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const isSelected = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            aria-pressed={isSelected}
            className={cn(
              "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
              isSelected
                ? "border-stone-800 bg-stone-800 text-white"
                : "border-stone-300 bg-white text-stone-700 hover:border-stone-500"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Step indicator ─────────────────────────────────────────────────────────

interface StepIndicatorProps {
  currentStep: number;
  steps: string[];
}

function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  return (
    <nav aria-label="Progress" className="mb-8">
      <ol className="flex items-center gap-2">
        {steps.map((step, i) => {
          const isDone = i < currentStep;
          const isCurrent = i === currentStep;
          return (
            <li key={step} className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
                  isDone && "bg-stone-800 text-white",
                  isCurrent && "bg-stone-800 text-white ring-4 ring-stone-100",
                  !isDone && !isCurrent && "border border-stone-300 text-stone-400 bg-white"
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isDone ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={cn(
                  "text-sm font-medium hidden sm:block",
                  isCurrent ? "text-stone-800" : "text-stone-400"
                )}
              >
                {step}
              </span>
              {i < steps.length - 1 && (
                <div className="h-px w-6 sm:w-10 bg-stone-200 mx-1" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

const STEPS = ["Property Details", "Buyer Demographics"];

export default function NewProjectPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<string[]>([""]);
  const [currentStep, setCurrentStep] = useState(0);
  const [draftSaved, setDraftSaved] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    propertyAddress: "",
    clientName: "",
    targetBuyer: "",
    stagingAesthetic: "",
    stagingPackage: "",
  });

  const [buyerDemographics, setBuyerDemographics] = useState<BuyerDemographics>(
    DEFAULT_BUYER_DEMOGRAPHICS
  );

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  const handleRoomChange = (index: number, value: string) => {
    const updated = [...rooms];
    updated[index] = value;
    setRooms(updated);
  };

  const addRoom = () => setRooms([...rooms, ""]);

  const removeRoom = (index: number) => {
    if (rooms.length > 1) {
      setRooms(rooms.filter((_, i) => i !== index));
    }
  };

  const createProject = async () => {
    setSubmitting(true);
    setError(null);

    if (!form.targetBuyer) {
      setError("Please select a target buyer persona.");
      setSubmitting(false);
      return;
    }

    if (!form.stagingAesthetic) {
      setError("Please select a staging aesthetic.");
      setSubmitting(false);
      return;
    }

    const validRooms = rooms.filter((r) => r.trim() !== "");

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        buyerDemographics,
        rooms: validRooms,
      }),
    });

    if (response.ok) {
      const { id } = await response.json();
      router.push(`/projects/${id}`);
    } else {
      const data = await response.json();
      setError(data.error || "Failed to create project");
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createProject();
  };

  // Issue #619: "Save Draft" persists the in-progress consultation to
  // localStorage (client-side only) and flashes a confirmation on the bar.
  const handleSaveDraft = () => {
    try {
      window.localStorage.setItem(
        "staging-studio:new-project-draft",
        JSON.stringify({ form, buyerDemographics, rooms, currentStep })
      );
      setDraftSaved(true);
      window.setTimeout(() => setDraftSaved(false), 2500);
    } catch {
      // Storage unavailable (private mode/quota) — draft saving is best-effort.
    }
  };

  const configName = consultationConfigSummary({
    aesthetic: form.stagingAesthetic,
    packageName: getStagingPackage(form.stagingPackage)?.name ?? null,
    roomCount: rooms.filter((r) => r.trim() !== "").length,
  });

  const canAdvance =
    form.propertyAddress.trim() !== "" && form.clientName.trim() !== "";

  return (
    <div className="mx-auto max-w-2xl p-8 pb-44">
      <div className="mb-8">
        <h1 className="font-playfair text-3xl font-bold text-stone-800">
          New Project
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-stone-600">
          Step {currentStep + 1} of {STEPS.length}: {STEPS[currentStep]}
        </p>
      </div>

      <StepIndicator currentStep={currentStep} steps={STEPS} />

      {error && (
        <div
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ── Step 0: Property Details ─────────────────────────────── */}
        <div className={cn(currentStep === 0 ? "block" : "hidden")}>
          <div className="space-y-6">
            <div>
              <label
                htmlFor="propertyAddress"
                className="block text-sm font-medium text-stone-700"
              >
                Property Address
              </label>
              <input
                id="propertyAddress"
                type="text"
                required
                value={form.propertyAddress}
                onChange={(e) =>
                  setForm({ ...form, propertyAddress: e.target.value })
                }
                placeholder="742 Evergreen Terrace, Springfield"
                className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              />
            </div>

            <div>
              <label
                htmlFor="clientName"
                className="block text-sm font-medium text-stone-700"
              >
                Client Name
              </label>
              <input
                id="clientName"
                type="text"
                required
                value={form.clientName}
                onChange={(e) =>
                  setForm({ ...form, clientName: e.target.value })
                }
                placeholder="Maggie Simpson"
                className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              />
            </div>

            <div>
              <label
                htmlFor="targetBuyer"
                className="block text-sm font-medium text-stone-700"
              >
                Target Buyer Persona
              </label>
              <select
                id="targetBuyer"
                value={form.targetBuyer}
                onChange={(e) =>
                  setForm({ ...form, targetBuyer: e.target.value })
                }
                className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-stone-900 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              >
                <option value="">Select a buyer persona...</option>
                {BUYER_PERSONAS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="stagingAesthetic"
                className="block text-sm font-medium text-stone-700"
              >
                Staging Aesthetic
              </label>
              <select
                id="stagingAesthetic"
                value={form.stagingAesthetic}
                onChange={(e) =>
                  setForm({ ...form, stagingAesthetic: e.target.value })
                }
                className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-stone-900 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              >
                <option value="">Select an aesthetic...</option>
                {STAGING_AESTHETICS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <fieldset>
              <legend className="block text-sm font-medium text-stone-700">
                Staging Package
              </legend>
              <p className="mt-0.5 text-xs text-stone-500">
                Select a pricing tier for this project.
              </p>
              <div
                className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                role="radiogroup"
                aria-label="Staging package selection"
              >
                {STAGING_PACKAGES.map((pkg) => (
                  <StagingPackageCard
                    key={pkg.id}
                    pkg={pkg}
                    selected={form.stagingPackage === pkg.id}
                    onSelect={(id) => setForm({ ...form, stagingPackage: id })}
                    selectable
                  />
                ))}
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="room-0"
                className="block text-sm font-medium text-stone-700"
              >
                Rooms
              </label>
              <p className="mt-0.5 text-xs text-stone-500">
                Add each room you will be staging for this property.
              </p>
              <datalist id="room-type-suggestions">
                {/* eslint-disable jsx-a11y/control-has-associated-label -- datalist options are suggestions, not form controls */}
                {ROOM_TYPES.map((type) => (
                  <option key={type} value={type} />
                ))}
              </datalist>
              <div className="mt-3 space-y-2">
                {rooms.map((room, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      id={`room-${index}`}
                      type="text"
                      list="room-type-suggestions"
                      value={room}
                      onChange={(e) => handleRoomChange(index, e.target.value)}
                      placeholder="e.g. Living Room"
                      aria-label={`Room ${index + 1}`}
                      className="flex-1 rounded-md border border-stone-300 px-3 py-2 text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
                    />
                    {rooms.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRoom(index)}
                        aria-label={`Remove Room ${index + 1}`}
                        className="rounded-md px-2 py-1.5 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addRoom}
                className="mt-3 rounded-md border border-dashed border-stone-400 px-3 py-1.5 text-sm text-stone-600 hover:border-stone-500 hover:text-stone-700"
              >
                + Add another room
              </button>
            </div>

            <div className="flex items-center gap-3 pt-6">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                disabled={!canAdvance}
                className="rounded-md bg-stone-800 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-50"
              >
                Next: Buyer Demographics
              </button>
            </div>
          </div>
        </div>

        {/* ── Step 1: Buyer Demographics ───────────────────────────── */}
        <div className={cn(currentStep === 1 ? "block" : "hidden")}>
          <div className="space-y-8">
            {/* Buyer Type */}
            <fieldset>
              <legend className="text-sm font-medium text-stone-700">
                Buyer Type
              </legend>
              <p className="mt-0.5 text-xs text-stone-500">
                Select the primary buyer profile for this property.
              </p>
              <select
                id="buyerType"
                value={buyerDemographics.buyerType}
                onChange={(e) =>
                  setBuyerDemographics({
                    ...buyerDemographics,
                    buyerType: e.target.value as BuyerType,
                  })
                }
                className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              >
                {BUYER_TYPES.map((bt) => (
                  <option key={bt.value} value={bt.value}>
                    {bt.label}
                  </option>
                ))}
              </select>
            </fieldset>

            {/* Design Preferences */}
            <fieldset>
              <legend className="text-sm font-medium text-stone-700">
                Design Preferences
              </legend>
              <p className="mt-0.5 text-xs text-stone-500">
                Select all styles that appeal to this buyer.
              </p>
              <div className="mt-3">
                <ChipToggle
                  options={DESIGN_PREFERENCES}
                  selected={buyerDemographics.designPreferences}
                  onChange={(selected) =>
                    setBuyerDemographics({
                      ...buyerDemographics,
                      designPreferences: selected as DesignPreference[],
                    })
                  }
                />
              </div>
            </fieldset>

            {/* Budget Range */}
            <fieldset>
              <legend className="text-sm font-medium text-stone-700">
                Budget Range
              </legend>
              <p className="mt-0.5 text-xs text-stone-500">
                Estimated price range this buyer is considering.
              </p>
              <div className="mt-3">
                <BudgetSlider
                  min={BUDGET_MIN}
                  max={BUDGET_MAX}
                  step={25}
                  valueMin={buyerDemographics.budgetMin}
                  valueMax={buyerDemographics.budgetMax}
                  onChangeMin={(v) =>
                    setBuyerDemographics({ ...buyerDemographics, budgetMin: v })
                  }
                  onChangeMax={(v) =>
                    setBuyerDemographics({ ...buyerDemographics, budgetMax: v })
                  }
                />
              </div>
            </fieldset>

            {/* Must-Have Features */}
            <fieldset>
              <legend className="text-sm font-medium text-stone-700">
                Must-Have Features
              </legend>
              <p className="mt-0.5 text-xs text-stone-500">
                Features this buyer considers essential.
              </p>
              <div className="mt-3">
                <ChipToggle
                  options={MUST_HAVE_FEATURES}
                  selected={buyerDemographics.mustHaveFeatures}
                  onChange={(selected) =>
                    setBuyerDemographics({
                      ...buyerDemographics,
                      mustHaveFeatures: selected as MustHaveFeature[],
                    })
                  }
                />
              </div>
            </fieldset>

            {/* Sell Timeline */}
            <fieldset>
              <legend className="text-sm font-medium text-stone-700">
                Timeline to Sell
              </legend>
              <p className="mt-0.5 text-xs text-stone-500">
                How quickly does the seller need to close?
              </p>
              <select
                id="sellTimeline"
                value={buyerDemographics.sellTimeline}
                onChange={(e) =>
                  setBuyerDemographics({
                    ...buyerDemographics,
                    sellTimeline: e.target.value as SellTimeline,
                  })
                }
                className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              >
                {SELL_TIMELINES.map((tl) => (
                  <option key={tl.value} value={tl.value}>
                    {tl.label}
                  </option>
                ))}
              </select>
            </fieldset>
          </div>

          <div className="flex items-center gap-3 pt-8">
            <button
              type="button"
              onClick={() => setCurrentStep(0)}
              className="rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-stone-800 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create Project"}
            </button>
            <a
              href="/dashboard"
              className="rounded-md px-4 py-2.5 text-sm font-medium text-stone-600 hover:text-stone-800"
            >
              Cancel
            </a>
          </div>
        </div>
      </form>

      {/* Issue #619: sticky bottom consultation action bar */}
      <ConsultationActionBar
        configName={configName}
        onSaveDraft={handleSaveDraft}
        onProceed={createProject}
        busy={submitting}
        draftSaved={draftSaved}
      />
    </div>
  );
}
