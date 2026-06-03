import { loadMonorepoEnv } from "@clb-acel/service-kit";
import { buildMerchantServer } from "./server";

loadMonorepoEnv();

const port = Number(process.env.MERCHANT_AGENT_PORT ?? 4004);
const host = process.env.MERCHANT_AGENT_HOST ?? "0.0.0.0";

const app = await buildMerchantServer();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
