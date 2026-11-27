import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Each file starts its own PostgreSQL (PGlite) instance; give cold starts room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: { LANDED_SCRYPT_N: "1024", LANDED_PSEUDONYM_PEPPER: "test-pepper-0123456789abcdef0123456789abcdef" },
  },
});
