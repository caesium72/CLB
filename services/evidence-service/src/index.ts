import { loadMonorepoEnv } from "./load-env";
import { buildEvidenceServer } from "./server";

loadMonorepoEnv();

const port = Number(process.env.EVIDENCE_SERVICE_PORT ?? 4001);
const host = process.env.EVIDENCE_SERVICE_HOST ?? "0.0.0.0";

const app = await buildEvidenceServer();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
