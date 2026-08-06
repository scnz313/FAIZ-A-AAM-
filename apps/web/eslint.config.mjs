import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * ESLint 9 flat config. eslint-config-next 15.5.x ships legacy
 * (extends-based) configs only, so FlatCompat bridges them into the
 * flat format — the documented Next 15 + ESLint 9 pattern.
 */
const compat = new FlatCompat({
  baseDirectory: path.dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  {
    ignores: [".next/**", "node_modules/**", "out/**", "next-env.d.ts"],
  },
  {
    /*
     * The design system deliberately renders internal navigation as plain
     * styled anchors (the editorial link-arrow pattern; the Button
     * primitive also renders an anchor when given an href) — the app has
     * no next/link usage by design. Migrating to <Link> is a navigation
     * architecture decision for the backend phase, not a lint fix.
     */
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
];

export default eslintConfig;
