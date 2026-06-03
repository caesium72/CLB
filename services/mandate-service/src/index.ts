import { loadMonorepoEnv } from "@clb-acel/service-kit";
import { buildMandateServer } from "./server";

loadMonorepoEnv();

const port = Number(process.env.MANDATE_SERVICE_PORT ?? 4003);
const host = process.env.MANDATE_SERVICE_HOST ?? "0.0.0.0";

const app = await buildMandateServer();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
