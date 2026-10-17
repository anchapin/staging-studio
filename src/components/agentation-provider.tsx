"use client";

import { useEffect, useState } from "react";
import { Agentation } from "agentation";

// CSP `connect-src` in src/lib/security-headers.ts allows `http://127.0.0.1:*`
// and `wss://127.0.0.1:*` (issue #1076 — hermetic e2e harness). The hostname
// MUST be `127.0.0.1` (not `localhost`) because the CSP origin matches on the
// serialized host portion, not the resolved address. The MCP server is bound
// to `*:4747`, so both 127.0.0.1:4747 and localhost:4747 reach it from curl;
// only 127.0.0.1:4747 is permitted by the browser's CSP layer.
const AGENTATION_ENDPOINT = "http://127.0.0.1:4747";
const HEALTH_PROBE_INTERVAL_MS = 10_000;

/**
 * Visual-feedback toolbar wired to the agentation MCP server.
 *
 * The MCP server runs locally via `npx -y agentation-mcp server` (configured
 * in the user-global opencode MCP config). This component is rendered once
 * from the root layout so every authenticated route can submit annotations
 * back to the agent.
 *
 * Without `endpoint`, annotations stay in the browser for manual copying —
 * the endpoint is what forwards them to the MCP server.
 *
 * The wrapper also runs an independent health probe against `${endpoint}/health`
 * and surfaces a small floating indicator (top-right) ONLY when the probe
 * fails. This makes connection failures visible in screenshots and DevTools —
 * the bare `<Agentation>` toolbar collapses its UI when the server is
 * unreachable, which makes silent-failure debugging from the agent side
 * (e.g. via `npx agentation-mcp doctor` + SQLite inspection) guesswork.
 *
 * See #1377 (or the chat-described Agentation ask that motivated the change)
 * for the root cause this guards against: annotations added on a slow-compile
 * Next.js route (e.g. first request to a fresh dev-server port) were never
 * POSTed to `/sessions`, with no client-side signal that the connection had
 * not yet completed.
 */
export function AgentationProvider() {
  const [connectionState, setConnectionState] = useState<
    "checking" | "connected" | "disconnected"
  >("checking");

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function probe(): Promise<void> {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3_000);
        const res = await fetch(`${AGENTATION_ENDPOINT}/health`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (cancelled) return;
        if (res.ok) {
          if (connectionState !== "connected") {
            // eslint-disable-next-line no-console
            console.info(
              `[agentation] connected to ${AGENTATION_ENDPOINT}/health`,
            );
          }
          setConnectionState("connected");
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn(
          `[agentation] health probe failed against ${AGENTATION_ENDPOINT}/health:`,
          err instanceof Error ? err.message : err,
          "— annotations will stay in browser localStorage until the server is reachable. Run `npx agentation-mcp doctor` for diagnostics.",
        );
        setConnectionState("disconnected");
      }
    }

    void probe();
    interval = setInterval(probe, HEALTH_PROBE_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Agentation
        endpoint={AGENTATION_ENDPOINT}
        appName="staging-studio"
        enableKeyboardShortcuts={true}
      />
      {connectionState === "disconnected" ? (
        <div
          aria-live="polite"
          data-testid="agentation-disconnected"
          style={{
            position: "fixed",
            top: 8,
            right: 8,
            zIndex: 2147483647,
            padding: "4px 10px",
            borderRadius: 6,
            background: "rgba(180, 35, 24, 0.95)",
            color: "#fff",
            fontSize: 12,
            boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
            pointerEvents: "none",
          }}
          title={`Agentation server unreachable at ${AGENTATION_ENDPOINT}. Annotations stay in browser localStorage until the MCP server is reachable. Run \`npx agentation-mcp doctor\` for diagnostics.`}
        >
          agentation: disconnected
        </div>
      ) : null}
    </>
  );
}