import { AttacksTabs } from "./attacks-tabs";

export default function AttacksPage() {
  // Attacks run in-process via /api/demo/attacks (attack-core); no Fastify service.
  return <AttacksTabs serviceUrl="/api/demo" />;
}
