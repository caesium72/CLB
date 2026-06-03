import { loadMonorepoEnv } from "@clb-acel/service-kit";
import { buildIdentityServer } from "./server";

loadMonorepoEnv();

const port = Number(process.env.IDENTITY_SERVICE_PORT ?? 4002);
const host = process.env.IDENTITY_SERVICE_HOST ?? "0.0.0.0";

const app = await buildIdentityServer();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
