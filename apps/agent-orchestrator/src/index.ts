import { loadMonorepoEnv } from "@clb-acel/service-kit";
import { buildOrchestratorServer } from "./server";

loadMonorepoEnv();

const port = Number(process.env.AGENT_ORCHESTRATOR_PORT ?? 4000);
const host = process.env.AGENT_ORCHESTRATOR_HOST ?? "0.0.0.0";

const app = await buildOrchestratorServer();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
