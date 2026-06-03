import { loadMonorepoEnv } from "@clb-acel/service-kit";
import { buildAttackSimulatorServer } from "./server";

loadMonorepoEnv();

const port = Number(process.env.ATTACK_SIMULATOR_PORT ?? 4006);
const host = process.env.ATTACK_SIMULATOR_HOST ?? "0.0.0.0";

const app = await buildAttackSimulatorServer();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
