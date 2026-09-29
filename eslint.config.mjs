import { createRequire } from "module";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const require = createRequire(import.meta.url);
const jsxA11y = require("eslint-plugin-jsx-a11y");

const eslintConfig = [
  // Build output and Next's auto-generated next-env.d.ts are not lintable
  // sources; next lint applies its own ignores but plain eslint needs these.
  {
    ignores: [".next/**", "next-env.d.ts"],
  },
  // eslint-config-next 16.x ships flat configs natively (issue #1160); import
  // them directly instead of FlatCompat.extends, which cannot translate the
  // new flat-native structure and crashes config validation.
  ...nextCoreWebVitals,
  ...nextTypeScript,
  // next/core-web-vitals already registers the jsx-a11y plugin, so this block
  // spreads rules only. Re-registering it here would fail flat config's
  // plugin identity check: the preset registers a module-interop wrapper of
  // the plugin, not the raw require result. The wrapped instance comes from
  // the same resolved eslint-plugin-jsx-a11y copy, so these rule definitions
  // match the registered plugin exactly.
  //
  // eslint-config-next 16 ships eslint-plugin-react-hooks v6, whose new
  // compiler-era rules (refs, set-state-in-effect, immutability) flag 28
  // pre-existing patterns across the codebase as errors. Downgraded to warn
  // so the 15 -> 16 bump stays shippable; the warnings remain visible in
  // every lint run. Follow-up: fix the flagged patterns properly and
  // re-escalate these three rules to "error".
  {
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  {
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

const config = [
  ...eslintConfig,
  // Test files use `as any` for mock return types — this is intentional for test ergonomics.
  {
    files: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default config;
