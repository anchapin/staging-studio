import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig sets jsx: "preserve" for the Next.js build; vitest must
  // transform JSX itself or vite:import-analysis chokes on .tsx sources
  // (issue #1162 — the SidebarNav component test imports real TSX).
  // NOTE: this pipeline uses oxc, not esbuild — the `esbuild` key is ignored
  // here, and oxc wants the object form { runtime: "automatic" }.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    // Playwright owns the browser specs under tests/e2e (issue #165);
    // keep the vitest unit run scoped to the pure-logic tests.
    exclude: ["**/node_modules/**", "tests/e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
