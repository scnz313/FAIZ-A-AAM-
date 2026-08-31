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
    ignores: [".next/**", ".next-dev/**", "node_modules/**", "out/**", "next-env.d.ts"],
  },
  {
    /*
     * Internal page navigation uses Next client transitions so shared shells,
     * authenticated context, and route data are not discarded on every click.
     * External links, downloads, and explicit document reloads remain anchors.
     */
    rules: {
      "@next/next/no-html-link-for-pages": "error",
    },
  },
];

export default eslintConfig;
