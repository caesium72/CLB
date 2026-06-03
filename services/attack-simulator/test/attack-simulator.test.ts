import { describe, expect, test } from "bun:test";
import { buildAttackSimulatorServer } from "../src/server";

describe("attack-simulator", () => {
  test("lists and runs attack fixtures", async () => {
    const app = await buildAttackSimulatorServer({ logger: false });

    const attacks = await app.inject({ method: "GET", url: "/attacks" });
    expect(attacks.statusCode).toBe(200);
    expect(attacks.json<{ attacks: unknown[] }>().attacks).toHaveLength(10);

    const run = await app.inject({
      method: "POST",
      url: "/attacks/PAYEE_SUBSTITUTION/run",
      payload: { nowMs: 1_700_000_000_000 },
    });
    expect(run.statusCode).toBe(200);
    const runBody = run.json<{
      matched: boolean;
      anatomy: { summary: string; mutations: unknown[] };
      baselineComparison: Record<string, unknown>;
    }>();
    expect(runBody.matched).toBe(true);
    expect(runBody.anatomy.summary).toBeTruthy();
    expect(runBody.anatomy.mutations.length).toBeGreaterThan(0);
    expect(Object.keys(runBody.baselineComparison)).toEqual(["B0", "B1", "B2", "B3"]);

    await app.close();
  });
});
