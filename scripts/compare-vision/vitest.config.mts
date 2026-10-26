import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Separate config so the paid comparison never runs with `npm test`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
      "server-only": fileURLToPath(new URL("../../src/test/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    root: fileURLToPath(new URL("../..", import.meta.url)),
    include: ["scripts/compare-vision/*.run.ts"],
  },
});
