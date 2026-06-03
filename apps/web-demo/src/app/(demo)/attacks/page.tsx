import { AttacksTabs } from "./attacks-tabs";

export default function AttacksPage() {
  const serviceUrl = process.env.ATTACK_SIMULATOR_URL ?? "http://localhost:4006";

  return <AttacksTabs serviceUrl={serviceUrl} />;
}
