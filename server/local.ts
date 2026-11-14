import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";
import { ProviderRegistry } from "./providers.ts";
import {
  readComparison,
  registerRecent,
  registerXianVisibility,
} from "./recent.ts";
import { HistoryStore, historyPath, registerHistory } from "./quotsoft.ts";

export function createLocalApp() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const path = process.env.CACHE_PATH ?? "data/haze.sqlite";
  const registry = new ProviderRegistry();
  registerRecent(registry, root);
  registerXianVisibility(registry, root);
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
  app.get("/api/history-coverage", () => {
    const store = new HistoryStore(historyPath(root));
    try {
      return store.cityCoverage();
    } finally {
      store.close();
    }
  });
  app.get<{ Querystring: { cityId?: string; from?: string; to?: string } }>(
    "/api/history-archive",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["cityId", "from", "to"],
          properties: {
            cityId: { type: "string", minLength: 1, maxLength: 100 },
            from: { type: "string", format: "date" },
            to: { type: "string", format: "date" },
          },
        },
      },
    },
    (request) => {
      const { cityId, from, to } = request.query;
      const store = new HistoryStore(historyPath(root));
      try {
        return store.cityDays(cityId!, from!, to!);
      } finally {
        store.close();
      }
    },
  );
  return app;
}
