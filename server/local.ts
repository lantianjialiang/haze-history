import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";
import { mockRegistry } from "./providers.ts";
import { readComparison, registerRecent } from "./recent.ts";
import { HistoryStore, historyPath, registerHistory } from "./quotsoft.ts";

export function createLocalApp() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const path = process.env.CACHE_PATH ?? "data/haze.sqlite";
  const registry = mockRegistry();
  registerRecent(registry, root);
  registerHistory(registry, root);
  const app = buildApp({
    cachePath: path === ":memory:" ? path : resolve(root, path),
    ttlHours: Number(process.env.CACHE_TTL_HOURS ?? 12),
    minCoverage: Number(process.env.MIN_COVERAGE ?? 0.8),
    registry,
  });
  app.get("/api/recent-comparison", () => readComparison(root));
  app.get("/api/history-status", () => {
    const store = new HistoryStore(historyPath(root));
    const status = store.status();
    store.close();
    return status;
  });
  return app;
}
