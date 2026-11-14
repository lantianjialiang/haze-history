import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { createLocalApp } from "../server/local.ts";

const host = "127.0.0.1";
const apiPort = Number(process.env.PORT ?? 3001);
const app = createLocalApp();
let web: ViteDevServer | undefined;

async function close() {
  await Promise.all([web?.close(), app.close()]);
}

try {
  const apiAddress = await app
    .listen({ host, port: apiPort })
    .catch((error: NodeJS.ErrnoException) => {
      if (apiPort === 0 || error.code !== "EADDRINUSE") throw error;
      return app.listen({ host, port: 0 });
    });
  web = await createServer({
    root: fileURLToPath(new URL("../web", import.meta.url)),
    server: {
      strictPort: false,
      proxy: { "/api": apiAddress },
    },
  });
  await web.listen();
  console.log(`API: ${apiAddress}`);
  console.log(`Local: ${web.resolvedUrls!.local[0]}`);
} catch (error) {
  await close();
  throw error;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void close().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}
