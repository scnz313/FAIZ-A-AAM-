import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for @fass/web.
 * Mirrors apps/web/tsconfig.json paths: "@/*" → the app root and
 * "@fass/contracts" → the shared contracts source entry.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "@fass/contracts": fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
      "next/navigation": fileURLToPath(new URL("./test/next-navigation-mock.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    css: false,
  },
});
