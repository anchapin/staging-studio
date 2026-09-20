import { createRequire } from "module";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const require = createRequire(import.meta.url);
const jsxA11y = require("eslint-plugin-jsx-a11y");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Build output and Next's auto-generated next-env.d.ts are not lintable
  // sources; next lint applies its own ignores but plain eslint needs these.
  {
    ignores: [".next/**", "next-env.d.ts"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // next/core-web-vitals already registers the jsx-a11y plugin (same module
  // instance as this require), so flat config identity rules are satisfied by
  // reusing that registration; the plugin's own flatConfigs.recommended
  // bundles a second plugin instance and would fail the redefinition check.
  // Spread only its rules — the full recommended set, all as errors.
  {
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // The preset ships control-has-associated-label disabled but records
      // its options for opt-in; enable it as an error so icon-only controls
      // without an accessible name fail lint (issue #97 fence requirement).
      "jsx-a11y/control-has-associated-label": [
        "error",
        jsxA11y.flatConfigs.recommended.rules[
          "jsx-a11y/control-has-associated-label"
        ][1],
      ],
    },
  },
];

export default eslintConfig;
