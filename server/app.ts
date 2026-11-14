import Fastify from "fastify";
import { z } from "zod";
import { FIRST_DAY, today, validDate } from "../shared/dates.ts";
import {
  aggregate,
  classifyDays,
  longestStreak,
  ruleSchema,
  yearOverYear,
} from "../shared/rules.ts";
import { metrics, type ApiError, type HourlyResponse } from "../shared/types.ts";
import { geocode, staticCities } from "./geocode.ts";
import { SeriesCache } from "./cache.ts";
import { ProviderRegistry } from "./providers.ts";

const messages: Record<ApiError["code"], ApiError["message"]> = {
  GEOCODE_NOT_FOUND: { zh: "未找到该城市。", en: "City not found." },
  PROVIDER_UNAVAILABLE: {
    zh: "数据源暂不可用。",
    en: "Data source unavailable.",
  },
  PROVIDER_RATE_LIMITED: {
    zh: "数据源请求频率受限。",
    en: "Data source rate limit reached.",
  },
  NO_DATA: { zh: "该范围无数据。", en: "No data for this range." },
  INVALID_RULE: { zh: "规则配置无效。", en: "Invalid rule configuration." },
  INVALID_PARAMS: { zh: "请求参数无效。", en: "Invalid request parameters." },
  INTERNAL: { zh: "服务暂不可用。", en: "Service temporarily unavailable." },
};
const error = (
  code: ApiError["code"],
  suggestProviderIds?: string[],
): ApiError => ({ code, message: messages[code], suggestProviderIds });
const range = {
  cityId: z.string().min(1),
  providerId: z.string().min(1),
  from: z.string(),
  to: z.string(),
};
const validRange = ({ from, to }: { from: string; to: string }) =>
  validDate(from) &&
  validDate(to) &&
  from >= FIRST_DAY &&
  from <= to &&
  to <= today();
const seriesQuery = z.object({
  ...range,
  metrics: z
    .string()
    .transform((value) => value.split(","))
    .pipe(z.array(z.enum(metrics)).min(1).max(5)),
});
const statsBody = z.object({ ...range, rule: z.unknown() });

export function buildApp(options: {
  cachePath: string;
  ttlHours?: number;
  minCoverage?: number;
  registry?: ProviderRegistry;
}) {
  const app = Fastify();
  const registry = options.registry ?? new ProviderRegistry();
  const cache = new SeriesCache(options.cachePath, options.ttlHours);
  app.addHook("onClose", async () => cache.close());
  app.setErrorHandler<{ statusCode?: number }>((failure, request, reply) => {
    if (failure.statusCode && failure.statusCode < 500)
      return reply.code(failure.statusCode).send(error("INVALID_PARAMS"));
    request.log.error(failure);
    return reply.code(500).send(error("INTERNAL"));
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send(error("INVALID_PARAMS")),
  );
  app.get("/api/health", () => ({ status: "ok" }));
  app.get("/api/geocode", (req, reply) => {
    const query = z
      .object({
        q: z.string().trim().min(1).max(80),
        limit: z.coerce.number().int().min(1).max(40).default(8),
      })
      .safeParse(req.query);
    if (!query.success) return reply.code(400).send(error("INVALID_PARAMS"));
    return geocode(query.data.q, query.data.limit);
  });
  app.get("/api/sources", (req, reply) => {
    const query = z
      .object({ metric: z.enum(metrics).optional() })
      .safeParse(req.query);
    if (!query.success) return reply.code(400).send(error("INVALID_PARAMS"));
    return registry.list(query.data.metric);
  });
  const unavailable = (required: (typeof metrics)[number][]) =>
    error(
      "PROVIDER_UNAVAILABLE",
      registry
        .list()
        .filter((meta) =>
          required.every((metric) => meta.metrics.includes(metric)),
        )
        .map((meta) => meta.id),
    );
  app.get("/api/series", async (req, reply) => {
    const query = seriesQuery.safeParse(req.query);
    if (!query.success || !validRange(query.data))
      return reply.code(400).send(error("INVALID_PARAMS"));
    const { cityId, providerId, from, to, metrics } = query.data;
    const city = staticCities.get(cityId);
    if (!city) return reply.code(404).send(error("GEOCODE_NOT_FOUND"));
    const provider = registry.get(providerId);
    if (!provider) return reply.code(503).send(unavailable(metrics));
    try {
      return await cache.series(city, provider, from, to, metrics);
    } catch {
      return reply.code(503).send(unavailable(metrics));
    }
  });
  app.post("/api/stats", async (req, reply) => {
    const body = statsBody.safeParse(req.body);
    if (!body.success || !validRange(body.data))
      return reply.code(400).send(error("INVALID_PARAMS"));
    const { cityId, providerId, from, to } = body.data;
    const rule = ruleSchema.safeParse(body.data.rule);
    if (!rule.success) return reply.code(400).send(error("INVALID_RULE"));
    const city = staticCities.get(cityId);
    if (!city) return reply.code(404).send(error("GEOCODE_NOT_FOUND"));
    const provider = registry.get(providerId);
    const required = [
      ...new Set(rule.data.conditions.map((condition) => condition.metric)),
    ];
    if (!provider) return reply.code(503).send(unavailable(required));
    try {
      const series = await cache.series(city, provider, from, to, required);
      const statuses = classifyDays(series.records, rule.data);
      const yearly = aggregate(statuses, "year", options.minCoverage);
      return {
        city,
        rule: rule.data,
        providerId,
        yearly,
        monthly: aggregate(statuses, "month", options.minCoverage),
        extras: {
          longestStreak: longestStreak(statuses),
          yoy: yearOverYear(yearly),
        },
      };
    } catch {
      return reply.code(503).send(unavailable(required));
    }
  });
  app.get("/api/hours", async (req, reply) => {
    const query = z
      .object({
        cityId: z.string().min(1),
        providerId: z.string().min(1),
        date: z.string(),
      })
      .safeParse(req.query);
    if (!query.success || !validDate(query.data.date))
      return reply.code(400).send(error("INVALID_PARAMS"));
    const city = staticCities.get(query.data.cityId);
    if (!city) return reply.code(404).send(error("GEOCODE_NOT_FOUND"));
    const provider = registry.get(query.data.providerId);
    if (!provider) return reply.code(503).send(unavailable(metrics.slice()));
    if (!provider.getHourly)
      return {
        city,
        providerId: provider.meta.id,
        date: query.data.date,
        hours: [],
      } satisfies HourlyResponse;
    try {
      return {
        city,
        providerId: provider.meta.id,
        date: query.data.date,
        hours: await provider.getHourly(city, query.data.date),
      } satisfies HourlyResponse;
    } catch {
      return reply.code(503).send(unavailable(provider.meta.metrics));
    }
  });
  app.post("/api/cache/invalidate", () => ({ removed: cache.invalidate() }));
  return app;
}
