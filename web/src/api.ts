import type { ApiError } from "../../shared/types.ts";
export async function api<T>(
  path: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    "/api" + path,
    body === undefined
      ? { signal }
      : {
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (response.ok) return response.json() as Promise<T>;
  throw await response
    .json()
    .catch(() => ({ code: "INTERNAL" }) satisfies Pick<ApiError, "code">);
}
