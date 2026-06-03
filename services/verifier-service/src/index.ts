import { loadMonorepoEnv } from "@clb-acel/service-kit";
import { buildVerifierServer } from "./server";

loadMonorepoEnv();

const port = Number(process.env.VERIFIER_SERVICE_PORT ?? 4005);
const host = process.env.VERIFIER_SERVICE_HOST ?? "0.0.0.0";

const app = await buildVerifierServer();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
