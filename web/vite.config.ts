import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const envDir = fileURLToPath(new URL("../", import.meta.url));
export default defineConfig(({ mode }) => {
  const isStatic = mode === "static";
  const env = loadEnv(mode, envDir, "");
  const staticBase = env.VITE_BASE || "./";
  return {
    plugins: [react()],
    envDir,
    base: isStatic ? staticBase : "/",
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
  };
});
