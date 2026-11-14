import { createLocalApp } from "./local.ts";
const app = createLocalApp();
const address = await app.listen({
  host: "127.0.0.1",
  port: Number(process.env.PORT ?? 3001),
});
console.log(address);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void app.close();
  });
