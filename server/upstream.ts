export function upstream(intervalMs: number) {
  let next = 0;
  return async (url: string, headers?: HeadersInit) => {
    for (let attempt = 0; ; attempt++) {
      const start = Math.max(Date.now(), next);
      next = start + intervalMs;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(start - Date.now(), 0)),
      );
      try {
        const response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(15_000),
        });
        if (attempt === 3 || (response.status !== 429 && response.status < 500))
          return response;
        await response.body?.cancel();
        const delay = Number(response.headers.get("retry-after"));
        if (delay > 0) next = Math.max(next, Date.now() + delay * 1000);
      } catch (error) {
        if (attempt === 3) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  };
}
