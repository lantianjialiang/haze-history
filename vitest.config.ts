import { defineConfig } from "vitest/config";
const flags = ["--experimental-sqlite", "--experimental-require-module"];
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, ...flags]
  .filter(Boolean)
  .join(" ");
export default defineConfig({
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts"],
    pool: "forks",
  },
});
