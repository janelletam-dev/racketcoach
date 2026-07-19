import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // mirror the tsconfig "@/*": ["./*"] path alias
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.test.ts"],
  },
});
