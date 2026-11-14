import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const envDir = fileURLToPath(new URL("../", import.meta.url));
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  envDir,
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/api":
        "http://127.0.0.1:" +
        (process.env.PORT || loadEnv(mode, envDir, "").PORT || "3001"),
    },
  },
}));
