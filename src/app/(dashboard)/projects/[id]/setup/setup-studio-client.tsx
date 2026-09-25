"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { sliderFillStyle } from "@/lib/precision-slider";
import { saveProjectMetadata } from "@/app/actions/project";
import { ConsultationActionBar } from "@/components/dashboard/consultation-action-bar";
import { MoodboardSelector } from "@/components/dashboard/moodboard-selector";
import {
  DEFAULT_MOODBOARD_THEME_ID,
  MOODBOARD_MICRO_PARAMETERS,
  MOODBOARD_THEMES,
  NEURAL_STAGING_ENGINE_LABEL,
  type MoodboardThemeId,
} from "@/lib/moodboard-themes";
import {
  STUDIO_GOAL_OPTIONS,
  STUDIO_SCOPE_OPTIONS,
  buildStudioDirectivesSummary,
  studioStepHref,
  type StudioGoalId,
  type StudioScopeId,
} from "@/lib/studio-workflow";

interface SetupStudioClientProps {
  project: {
    id: string;
    propertyAddress: string;
    clientName: string;
    targetBuyer: string;
    stagingAesthetic: string;
    stagingDirectives: string | null;
  };
}

const BUYER_DEMOGRAPHIC_PRESETS = [
  "Young professional couple",
  "Growing family",
  "Empty nesters downsizing",
  "Relocating executive",
  "Investor buyer",
] as const;

const BUDGET_TIERS = [
  "Tier I — Accent ($2.5k–5k)",
  "Tier II — Signature ($5k–15k)",
  "Tier III — Estate ($15k+)",
] as const;

const SHELL_BASELINES = [
  "Modern open-plan",
  "Classic tri-level",
  "Loft industrial",
  "Craftsman heritage",
] as const;

const INPUT_CLASSES =
  "w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

const FIELD_LABEL_CLASSES =
  "mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground font-jakarta";

/**
 * Step 1 — Client Project Setup (issue #612).
 *
 * Property & Client Specification intake, the Staging Scope Matrix radio
 * selector, the Primary Consultation Goal toggle, and the Staging
 * Aesthetic Moodboard & Materiality selector (issue #621) with its AI
 * Spatial Directives & Micro-Parameters subpanel. The sticky bottom
 * consultation action bar (issue #619) is viewport-fixed by
 * `ConsultationActionBar` itself, so it persists across this page's
 * scroll. "Save Draft" persists the selections; "Save & Proceed" persists
 * then advances to Step 2 (Room Batch Stage).
 */
export function SetupStudioClient({ project }: SetupStudioClientProps) {
  const router = useRouter();

  // Property & Client Specification intake
  const [address, setAddress] = useState(project.propertyAddress);
  const [listingBroker, setListingBroker] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [budgetTier, setBudgetTier] = useState<string>(BUDGET_TIERS[1]);
  const [shellBaseline, setShellBaseline] = useState<string>(SHELL_BASELINES[0]);
  const [buyerDemographic, setBuyerDemographic] = useState(
    project.targetBuyer || BUYER_DEMOGRAPHIC_PRESETS[0]
  );

  // Staging Scope Matrix + Primary Consultation Goal
  const [scope, setScope] = useState<StudioScopeId>("full-5-room");
  const [goal, setGoal] = useState<StudioGoalId>("client-pitch");

  // Moodboard + AI micro-parameters
  const [selectedThemeId, setSelectedThemeId] = useState<MoodboardThemeId | null>(
    MOODBOARD_THEMES.find((theme) => theme.name === project.stagingAesthetic)
      ?.id ?? DEFAULT_MOODBOARD_THEME_ID
  );
  const [microParameters, setMicroParameters] = useState<{
    preservationStrictness: number;
    foliageFill: number;
  }>({
    preservationStrictness:
      MOODBOARD_MICRO_PARAMETERS.preservationStrictness.defaultValue,
    foliageFill: MOODBOARD_MICRO_PARAMETERS.foliageFill.defaultValue,
  });

  const [busy, setBusy] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  const selectedThemeName = useMemo(
    () =>
      selectedThemeId === null
        ? null
        : (MOODBOARD_THEMES.find((theme) => theme.id === selectedThemeId)
            ?.name ?? null),
    [selectedThemeId]
  );

  const persistSelections = useCallback(async () => {
    const summary = buildStudioDirectivesSummary({
      themeName: selectedThemeName,
      scope,
      goal,
      microParameters,
    });
    return saveProjectMetadata(project.id, {
      ...(address.trim() ? { propertyAddress: address.trim() } : {}),
      ...(selectedThemeName ? { stagingAesthetic: selectedThemeName } : {}),
      ...(summary ? { stagingDirectives: summary } : {}),
    });
  }, [
    address,
    goal,
    microParameters,
    project.id,
    scope,
    selectedThemeName,
  ]);

  const handleSaveDraft = useCallback(async () => {
    setBusy(true);
    try {
      await persistSelections();
      setDraftSaved(true);
      window.setTimeout(() => setDraftSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  }, [persistSelections]);

  const handleProceed = useCallback(async () => {
    setBusy(true);
    try {
      await persistSelections();
      router.push(studioStepHref(project.id, "rooms"));
    } finally {
      setBusy(false);
    }
  }, [persistSelections, project.id, router]);

  return (
    <>
      <div className="mx-auto flex max-w-[1560px] flex-col gap-8 px-6 py-8">
        {/* ── Property & Client Specification ─────────────────────────── */}
        <section
          aria-label="Property and client specification"
          className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-6"
        >
          <h2 className="font-playfair text-xl font-semibold text-foreground">
            Property &amp; Client Specification
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Intake details that anchor every downstream AI directive.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <label htmlFor="setup-address" className={FIELD_LABEL_CLASSES}>
                Property Address
              </label>
              <input
                id="setup-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className={INPUT_CLASSES}
                placeholder="142 Willow Lane"
              />
            </div>
            <div>
              <label htmlFor="setup-broker" className={FIELD_LABEL_CLASSES}>
                Listing Broker
              </label>
              <input
                id="setup-broker"
                value={listingBroker}
                onChange={(e) => setListingBroker(e.target.value)}
                className={INPUT_CLASSES}
                placeholder="Broker of record"
              />
            </div>
            <div>
              <label htmlFor="setup-price" className={FIELD_LABEL_CLASSES}>
                Target Price
              </label>
              <input
                id="setup-price"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                className={INPUT_CLASSES}
                placeholder="$1,250,000"
                inputMode="decimal"
              />
            </div>
            <div>
              <label htmlFor="setup-budget" className={FIELD_LABEL_CLASSES}>
                Staging Budget Tier
              </label>
              <select
                id="setup-budget"
                value={budgetTier}
                onChange={(e) => setBudgetTier(e.target.value)}
                className={INPUT_CLASSES}
              >
                {BUDGET_TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="setup-shell" className={FIELD_LABEL_CLASSES}>
                Architectural Shell Baseline
              </label>
              <select
                id="setup-shell"
                value={shellBaseline}
                onChange={(e) => setShellBaseline(e.target.value)}
                className={INPUT_CLASSES}
              >
                {SHELL_BASELINES.map((shell) => (
                  <option key={shell} value={shell}>
                    {shell}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="setup-buyer" className={FIELD_LABEL_CLASSES}>
                Target Buyer Demographic
              </label>
              <select
                id="setup-buyer"
                value={buyerDemographic}
                onChange={(e) => setBuyerDemographic(e.target.value)}
                className={INPUT_CLASSES}
              >
                {BUYER_DEMOGRAPHIC_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* ── Staging Scope Matrix ────────────────────────────────────── */}
        <section
          aria-label="Staging scope matrix"
          className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-6"
        >
          <h2 className="font-playfair text-xl font-semibold text-foreground">
            Staging Scope Matrix
          </h2>
          <fieldset className="mt-4">
            <legend className="sr-only">Select the staging scope</legend>
            <div
              role="radiogroup"
              aria-label="Staging scope"
              className="grid grid-cols-1 gap-3 md:grid-cols-3"
            >
              {STUDIO_SCOPE_OPTIONS.map((option) => {
                const isActive = scope === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => setScope(option.id)}
                    className={cn(
                      "rounded-xl border p-4 text-left transition-colors",
                      isActive
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-outline-variant/40 hover:border-outline-variant hover:bg-surface-container-low"
                    )}
                  >
                    <span className="block text-sm font-semibold text-foreground font-jakarta">
                      {option.label}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        </section>

        {/* ── Primary Consultation Goal ───────────────────────────────── */}
        <section
          aria-label="Primary consultation goal"
          className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-6"
        >
          <h2 className="font-playfair text-xl font-semibold text-foreground">
            Primary Consultation Goal
          </h2>
          <div
            role="radiogroup"
            aria-label="Consultation goal"
            className="mt-4 inline-flex rounded-full border border-outline-variant/40 bg-surface-container-low p-1"
          >
            {STUDIO_GOAL_OPTIONS.map((option) => {
              const isActive = goal === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  title={option.description}
                  onClick={() => setGoal(option.id)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-sm font-medium transition-colors font-jakarta",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Staging Aesthetic Moodboard & Materiality ───────────────── */}
        <section
          aria-label="Staging aesthetic moodboard and materiality"
          className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-playfair text-xl font-semibold text-foreground">
                Staging Aesthetic Moodboard &amp; Materiality
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Select the directive that drives every room render.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1 text-xs font-medium text-muted-foreground font-jakarta">
              <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
              {NEURAL_STAGING_ENGINE_LABEL}
            </span>
          </div>

          <MoodboardSelector
            className="mt-6"
            defaultSelectedThemeId={selectedThemeId}
            onSelect={setSelectedThemeId}
            defaultPreservationStrictness={
              microParameters.preservationStrictness
            }
            defaultFoliageFill={microParameters.foliageFill}
            onMicroParameterChange={setMicroParameters}
          />

          {/* AI Spatial Directives & Micro-Parameters readout */}
          <div className="mt-6 grid grid-cols-1 gap-4 rounded-lg border border-outline-variant/30 bg-surface-container-low/50 p-4 sm:grid-cols-2">
            {(
              [
                [
                  MOODBOARD_MICRO_PARAMETERS.preservationStrictness,
                  microParameters.preservationStrictness,
                ],
                [
                  MOODBOARD_MICRO_PARAMETERS.foliageFill,
                  microParameters.foliageFill,
                ],
              ] as const
            ).map(([parameter, value]) => (
              <div key={parameter.label} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground font-jakarta">
                  <span>{parameter.label}</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {value}
                  </span>
                </div>
                <div
                  className="h-1.5 w-full rounded-full bg-surface-container"
                  role="presentation"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-150"
                    style={sliderFillStyle(value, 0, 100)}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Sticky bottom consultation action bar (issue #619) — the
          component pins itself to the viewport, so it stays put while
          this page scrolls. */}
      <ConsultationActionBar
        configName={selectedThemeName ?? "Unconfigured"}
        onSaveDraft={() => void handleSaveDraft()}
        onProceed={() => void handleProceed()}
        busy={busy}
        draftSaved={draftSaved}
      />
    </>
  );
}
