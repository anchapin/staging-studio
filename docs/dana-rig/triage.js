#!/usr/bin/env node
/**
 * Dana Finding Triage — offline cross-run dedup + severity/category classification.
 *
 * Reads a Dana synthetic-usability report, classifies each finding via the TypeSafe
 * (Jev) typed-decision API, deduplicates against the nearest baseline findings, and
 * outputs a concise nightly summary.
 *
 * Usage:
 *   node triage.js <report.md> [--baseline <baseline-report.md>] [--output -]
 *   node triage.js --help
 *
 * Environment variables (also read from .env in DANA_RIG dir):
 *   TYPESAFE_API_KEY   TypeSafe API key for Jev typed-decision calls
 *   TYPESAFE_MODEL     Model name (default: jev-latest)
 *   DANA_RIG          Path to the dana-rig directory (for .env and baseline storage)
 *
 * Guardrails:
 *   - Only auto-escalates severity ≥ 2 AND confidence ≥ 0.7
 *   - Everything else lands in a collapsed appendix (never deleted)
 *   - Alex's final judgment stays manual
 */

"use strict";

import { readFileSync, readdirSync, statSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const __env = join(__dirname, ".env");

function loadEnv() {
  try {
    const content = readFileSync(__env, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch {}
}

loadEnv();

const TYPESAFE_KEY = process.env.TYPESAFE_API_KEY || process.env.TYPESAFE_API_KEY;
const TYPESAFE_MODEL = process.env.TYPESAFE_MODEL || "jev-latest";
const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const DANA_RIG = process.env.DANA_RIG || __dirname;
const BASELINE_CACHE = join(DANA_RIG, ".triage-baseline.json");

if (!TYPESAFE_KEY) {
  console.error("Error: TYPESAFE_API_KEY is not set. Set it in environment or .env file.");
  process.exit(1);
}

// ─── Help ────────────────────────────────────────────────────────────────────

const HELP = `
Dana Finding Triage — offline cross-run dedup + classification

Usage:
  node triage.js <report.md> [options]
  node triage.js --latest [--baseline <file>]  (use most recent Dana report)
  node triage.js --help

Options:
  --baseline <file>   Include this report as baseline for cross-run dedup.
                      Stored baseline is auto-updated after each run.
  --output <path>     Write summary to <path> (default: stdout)
  --store-baseline    Write this run's findings as the new baseline
  --no-dedup          Skip cross-run deduplication
  --help              Show this message

Environment:
  TYPESAFE_API_KEY   Required. Get from typesafe.ai
  TYPESAFE_MODEL     Default: jev-latest
  DANA_RIG           Path to dana-rig (default: script dir)

Output:
  N new findings, M severity-N, K severity-K ...
  [High confidence escalations only — severity ≥ 2 AND confidence ≥ 0.7]
  [Collapsed appendix: all other findings]
`.trim();

// ─── Arg parsing ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let reportPath = null;
let baselinePath = null;
let outputPath = null;
let storeBaseline = false;
let skipDedup = false;
let useLatest = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--help" || a === "-h") { console.log(HELP); process.exit(0); }
  else if (a === "--latest") { useLatest = true; }
  else if (a === "--baseline") { baselinePath = args[++i]; }
  else if (a === "--output") { outputPath = args[++i]; }
  else if (a === "--store-baseline") { storeBaseline = true; }
  else if (a === "--no-dedup") { skipDedup = true; }
  else if (!a.startsWith("-")) { reportPath = a; }
  else { console.error(`Unknown option: ${a}`); process.exit(1); }
}

if (!reportPath && !useLatest) {
  console.error("Error: specify a report path or use --latest");
  console.error("Run with --help for usage.");
  process.exit(1);
}

// ─── Find latest report ───────────────────────────────────────────────────────

function findLatestReport() {
  const reportsDir = process.env.DANA_REPORTS || join(DANA_RIG, "..", "..");
  let latest = null, latestMtime = 0;
  try {
    for (const f of readdirSync(reportsDir)) {
      if (!f.startsWith("dana-") || !f.endsWith(".md")) continue;
      const p = join(reportsDir, f);
      try {
        const mtime = statSync(p).mtimeMs;
        if (mtime > latestMtime) { latestMtime = mtime; latest = p; }
      } catch {}
    }
  } catch {}
  return latest;
}

if (useLatest) {
  reportPath = findLatestReport();
  if (!reportPath) {
    console.error("Error: --latest specified but no dana-*.md report found.");
    process.exit(1);
  }
}

// ─── Finding extraction ───────────────────────────────────────────────────────

/**
 * Extract ranked friction findings from a Dana report.
 * Expected section:
 *   ## 3. Ranked Friction List
 *   | Rank | Severity | Friction Point | Location | Dana's Experience & Suggestion |
 *   | :--- | :--- | :--- | :--- | :--- |
 *   | **1** | Low / Cosmetic | <text> | <file> | <text> |
 */
function extractFindings(markdown) {
  const findings = [];
  const lines = markdown.split("\n");
  let inFrictionSection = false;
  let tableStarted = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!inFrictionSection && /^##\s+3\.\s+Ranked Friction List/i.test(line)) {
      inFrictionSection = true;
      continue;
    }
    if (inFrictionSection && line === "") {
      if (tableStarted) break;
      continue;
    }
    if (inFrictionSection && line.startsWith("|") && line.includes("---")) {
      tableStarted = true;
      continue;
    }
    if (inFrictionSection && tableStarted && line.startsWith("|")) {
      const cols = line.split("|").slice(1, -1).map(c => c.trim());
      if (cols.length < 4 || !cols[0] || !cols[1]) continue;
      const rank = cols[0].replace(/\*\*/g, "").trim();
      const severityRaw = cols[1].toLowerCase();
      const frictionText = cols[2] || "";
      const location = cols[3] || "";
      const suggestion = cols[4] || "";

      if (!frictionText) continue;

      findings.push({
        rank,
        severityRaw,
        text: frictionText,
        location,
        suggestion,
        label: null, // will be set by classifier
        severity: null,
        severityConfidence: null,
        category: null,
        categoryConfidence: null,
        dedupResult: null, // null = no dedup, {same: bool, confidence: num, baselineIdx: num}
      });
    }
  }

  return findings;
}

// ─── TypeSafe / Jev API call ─────────────────────────────────────────────────

async function postTypesafe(questions) {
  const body = {
    model: TYPESAFE_MODEL,
    state: {
      page: { url: "file://triage", title: "Dana Finding Triage", text: "" },
      elements: [],
      recent_actions: [],
    },
    questions,
  };

  return new Promise((resolve, reject) => {
    const url = new URL(TYPESAFE_URL);
    const client = url.protocol === "https:" ? https : http;
    const postData = JSON.stringify(body);
    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
          "Authorization": `Bearer ${TYPESAFE_KEY}`,
        },
      },
      (res) => {
        let data = "";
        res.on("data", chunk => { data += chunk; });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(`TypeSafe API ${res.statusCode}: ${JSON.stringify(parsed)}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Failed to parse TypeSafe response: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Classify a single finding's severity and category via TypeSafe Jev API.
 */
async function classifyFinding(finding) {
  const text = finding.text;

  const questions = {
    severity: {
      type: "choice",
      criteria: {
        "0": `Nit — cosmetic only, no functional impact: "${text.slice(0, 80)}"`,
        "1": `Minor friction — inconvenient but workaround exists: "${text.slice(0, 80)}"`,
        "2": `Blocks or misleads — causes confusion or prevents task completion: "${text.slice(0, 80)}"`,
        "3": `Broken — application error, dead UI, or completely unusable flow: "${text.slice(0, 80)}"`,
      },
      instructions: {
        goal: `Classify the severity of this usability finding. 0=nit, 1=minor friction, 2=blocks/misleads, 3=broken.`,
        rules: "Choose the severity level that best matches the finding description.",
      },
    },
    category: {
      type: "choice",
      criteria: {
        broken: `Broken — something is non-functional or erroring: "${text.slice(0, 80)}"`,
        confusing_copy: `Confusing copy — misleading label, unclear text, wrong expectation: "${text.slice(0, 80)}"`,
        missing_feedback: `Missing feedback — app doesn't communicate state or what's expected: "${text.slice(0, 80)}"`,
        workflow_friction: `Workflow friction — extra steps, awkward flow, missing shortcuts: "${text.slice(0, 80)}"`,
        visual_polish: `Visual polish — spacing, alignment, font, color cosmetic issues: "${text.slice(0, 80)}"`,
      },
      instructions: {
        goal: `Classify the category of this usability finding. Choose the single best category.`,
        rules: "Choose the one category that best describes this issue type.",
      },
    },
  };

  const result = await postTypesafe(questions);
  const answers = result.answers || {};

  const sev = answers.severity || {};
  const cat = answers.category || {};

  finding.severity = sev.choice !== undefined ? String(sev.choice) : null;
  finding.severityConfidence = sev.confidence ?? null;
  finding.category = cat.choice !== undefined ? String(cat.choice) : null;
  finding.categoryConfidence = cat.confidence ?? null;

  return finding;
}

/**
 * Batched classification: process findings in batches to avoid overwhelming the API.
 */
async function classifyFindings(findings, { batchSize = 5 } = {}) {
  const classified = [];
  for (let i = 0; i < findings.length; i += batchSize) {
    const batch = findings.slice(i, i + batchSize);
    process.stderr.write(
      `[triage] classifying findings ${i + 1}–${i + batch.length} of ${findings.length}...\n`
    );
    const results = await Promise.all(batch.map(f => classifyFinding(f)));
    classified.push(...results);
    if (i + batchSize < findings.length) {
      await new Promise(r => setTimeout(r, 200)); // small delay between batches
    }
  }
  return classified;
}

// ─── Cross-run dedup via noul ────────────────────────────────────────────────

/**
 * Ask noul (TypeSafe) whether two findings describe the same underlying issue.
 * Returns { same: bool, confidence: number }.
 */
async function noulSameIssue(findingA, findingB) {
  const questions = {
    same_issue: {
      type: "choice",
      criteria: {
        YES: `YES — these findings describe the SAME underlying issue:\n  A: "${findingA.text.slice(0, 120)}"\n  B: "${findingB.text.slice(0, 120)}"`,
        NO: `NO — these findings describe DIFFERENT issues:\n  A: "${findingA.text.slice(0, 120)}"\n  B: "${findingB.text.slice(0, 120)}"`,
      },
      instructions: {
        goal: "Do these two usability findings describe the same underlying issue (same root cause)? Answer YES or NO.",
        rules: "Judge whether fixing one would address both, or if they require different fixes.",
      },
    },
  };

  const result = await postTypesafe(questions);
  const answer = result.answers?.same_issue || {};
  const choice = answer.choice;
  return {
    same: choice === "YES",
    confidence: answer.confidence ?? null,
    probabilities: answer.probabilities || {},
  };
}

/**
 * Dedup new findings against baseline findings.
 * Uses BM25-like keyword pre-filter before calling noul.
 * Returns new findings (deduped flags set on duplicates).
 */
async function dedupFindings(newFindings, baselineFindings, { topK = 5 } = {}) {
  if (skipDedup || baselineFindings.length === 0 || newFindings.length === 0) {
    return newFindings;
  }

  // Simple keyword set pre-filter
  function keywords(text) {
    return new Set(
      text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 3)
    );
  }

  function score(a, b) {
    const ka = keywords(a);
    const kb = keywords(b);
    const intersection = [...ka].filter(w => kb.has(w)).length;
    const union = new Set([...ka, ...kb]).size;
    return union === 0 ? 0 : intersection / union;
  }

  const deduplicated = [];

  for (let i = 0; i < newFindings.length; i++) {
    const newF = newFindings[i];
    let bestMatch = null;
    let bestScore = 0;

    // Find top-K most similar baseline findings using keyword overlap
    const scored = baselineFindings
      .map((bf, idx) => ({ bf, idx, sim: score(newF.text, bf.text) }))
      .filter(s => s.sim > 0.1)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, topK);

    if (scored.length > 0) {
      process.stderr.write(`[triage] dedup finding ${i + 1}/${newFindings.length}: top ${scored.length} candidates... `);
      for (const { bf, idx, sim } of scored) {
        try {
          const result = await noulSameIssue(newF, bf);
          if (result.same && result.confidence >= 0.5) {
            if (sim > bestScore) {
              bestScore = sim;
              bestMatch = { ...bf, dedupConfidence: result.confidence, dedupSim: sim, baselineIdx: idx };
            }
          }
        } catch (e) {
          process.stderr.write(`[triage] noul error: ${e.message}\n`);
        }
      }
    }

    newF.dedupResult = bestMatch;
    deduplicated.push(newF);
    const matchStr = bestMatch ? ` deduped→[rank ${bestMatch.rank} @ conf ${bestMatch.dedupConfidence?.toFixed(2)}]` : " NEW";
    process.stderr.write(`${matchStr}\n`);

    if (i < newFindings.length - 1) {
      await new Promise(r => setTimeout(r, 150));
    }
  }

  return deduplicated;
}

// ─── Baseline storage ─────────────────────────────────────────────────────────

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_CACHE, "utf8"));
  } catch {
    return [];
  }
}

function saveBaseline(findings) {
  const toSave = findings.map(({ rank, text, location, severity, category, severityConfidence, categoryConfidence }) => ({
    rank, text, location, severity, category, severityConfidence, categoryConfidence,
  }));
  import("fs").then(({ writeFileSync }) => {
    writeFileSync(BASELINE_CACHE, JSON.stringify(toSave, null, 2));
    process.stderr.write(`[triage] baseline updated: ${BASELINE_CACHE} (${toSave.length} findings)\n`);
  });
}

// ─── Output formatting ────────────────────────────────────────────────────────

function formatSummary(reportPath, findings) {
  const lines = [];
  const date = basename(reportPath, ".md").replace("dana-", "");

  const newFindings = findings.filter(f => !f.dedupResult);
  const dupFindings = findings.filter(f => !!f.dedupResult);

  // Counts
  const bySeverity = { "0": 0, "1": 0, "2": 0, "3": 0, unknown: 0 };
  for (const f of findings) {
    bySeverity[f.severity ?? "unknown"]++;
  }

  const sevLabel = s => ({ "0": "nit", "1": "minor-friction", "2": "blocks", "3": "broken" })[s] || s;
  const parts = [];
  for (const [sev, count] of Object.entries(bySeverity)) {
    if (count > 0) parts.push(`${count} severity-${sevLabel(sev)}`);
  }

  lines.push(`## Dana Triage — ${date}`);
  lines.push("");
  if (dupFindings.length > 0) {
    lines.push(`**${newFindings.length} new findings**, ${dupFindings.length} reproduced/changed (vs baseline)`);
  } else {
    lines.push(`**${newFindings.length} findings**`);
  }
  if (parts.length > 0) lines.push(parts.join(", "));
  lines.push("");

  // Escalations (severity ≥ 2 AND confidence ≥ 0.7)
  const escalations = findings.filter(f =>
    f.severity !== null &&
    parseInt(f.severity) >= 2 &&
    (f.severityConfidence ?? 0) >= 0.7
  );

  if (escalations.length > 0) {
    lines.push("### Escalations (severity ≥ 2, confidence ≥ 0.7)");
    lines.push("");
    for (const f of escalations) {
      lines.push(`- **[${f.rank}] severity-${f.severity}** [${f.category}@${f.severityConfidence?.toFixed(2)}] ${f.text.slice(0, 120)}${f.location ? ` (${f.location})` : ""}`);
    }
    lines.push("");
  }

  // New findings not escalated
  const newNotEscalated = newFindings.filter(f =>
    !(parseInt(f.severity) >= 2 && (f.severityConfidence ?? 0) >= 0.7)
  );
  if (newNotEscalated.length > 0) {
    lines.push(`### New findings (${newNotEscalated.length})`);
    for (const f of newNotEscalated) {
      lines.push(`- [${f.rank}] severity-${f.severity ?? "?"} [${f.category ?? "?"}@${f.severityConfidence?.toFixed(2) ?? "?"}] ${f.text.slice(0, 120)}`);
    }
    lines.push("");
  }

  // Dedup results
  if (dupFindings.length > 0) {
    lines.push(`### Reproduced/changed (${dupFindings.length})`);
    lines.push("");
    for (const f of dupFindings) {
      const d = f.dedupResult;
      const label = d && (parseInt(d.severity) !== parseInt(f.severity)) ? "CHANGED" : "REPRODUCED";
      lines.push(`- [${label}] rank ${d?.rank ?? "?"}→${f.rank}: ${f.text.slice(0, 80)}${d ? ` (conf ${d.dedupConfidence?.toFixed(2)})` : ""}`);
    }
    lines.push("");
  }

  // Appendix (collapsed — all findings with all metadata)
  lines.push("---");
  lines.push("### Appendix (all findings)");
  lines.push("");
  lines.push("<details>");
  lines.push("<summary>Show all findings</summary>");
  lines.push("");
  lines.push("| Rank | Severity | Confidence | Category | Text | Location | Dedup |");
  lines.push("|------|----------|------------|----------|------|----------|-------|");
  for (const f of findings) {
    const dedupStr = f.dedupResult ? `→ rank ${f.dedupResult.rank} (${f.dedupResult.dedupConfidence?.toFixed(2)})` : "—";
    const sevStr = f.severity ?? "?";
    const confStr = f.severityConfidence?.toFixed(2) ?? "?";
    const catStr = f.category ?? "?";
    const catConfStr = f.categoryConfidence?.toFixed(2) ?? "?";
    lines.push(`| ${f.rank} | ${sevStr} (${confStr}) | ${catStr} (${catConfStr}) | ${f.text.slice(0, 60)} | ${f.location || "—"} | ${dedupStr} |`);
  }
  lines.push("");
  lines.push("</details>");

  return lines.join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!reportPath) {
    console.error("Error: no report specified.");
    process.exit(1);
  }

  process.stderr.write(`[triage] reading report: ${reportPath}\n`);

  let reportMarkdown;
  try {
    reportMarkdown = readFileSync(reportPath, "utf8");
  } catch (e) {
    console.error(`Error reading report: ${e.message}`);
    process.exit(1);
  }

  const findings = extractFindings(reportMarkdown);
  process.stderr.write(`[triage] extracted ${findings.length} findings\n`);

  if (findings.length === 0) {
    const output = `## Dana Triage — ${basename(reportPath, ".md").replace("dana-", "")}\n\nNo findings in friction list.\n`;
    if (outputPath) {
      import("fs").then(({ writeFileSync }) => writeFileSync(outputPath, output));
      console.log(`[triage] written: ${outputPath}`);
    } else {
      console.log(output);
    }
    return;
  }

  // Load baseline
  let baselineFindings = [];
  if (baselinePath) {
    try {
      const baselineMarkdown = readFileSync(baselinePath, "utf8");
      baselineFindings = extractFindings(baselineMarkdown);
      process.stderr.write(`[triage] baseline loaded: ${baselineFindings.length} findings\n`);
    } catch (e) {
      process.stderr.write(`[triage] warning: could not load baseline: ${e.message}\n`);
    }
  } else {
    baselineFindings = loadBaseline();
    if (baselineFindings.length > 0) {
      process.stderr.write(`[triage] stored baseline: ${baselineFindings.length} findings\n`);
    }
  }

  // Classify findings
  process.stderr.write(`[triage] classifying ${findings.length} findings via TypeSafe...\n`);
  const classified = await classifyFindings(findings);

  // Cross-run dedup
  if (!skipDedup && baselineFindings.length > 0) {
    process.stderr.write(`[triage] cross-run dedup against ${baselineFindings.length} baseline findings...\n`);
    await dedupFindings(classified, baselineFindings);
  }

  // Store baseline if requested
  if (storeBaseline) {
    saveBaseline(classified);
  }

  // Format and output
  const summary = formatSummary(reportPath, classified);

  if (outputPath) {
    const { writeFileSync } = await import("fs");
    writeFileSync(outputPath, summary);
    console.log(`[triage] written: ${outputPath}`);
  } else {
    console.log(summary);
  }
}

main().catch(e => {
  console.error(`[triage] fatal: ${e.message}`);
  process.exit(1);
});
