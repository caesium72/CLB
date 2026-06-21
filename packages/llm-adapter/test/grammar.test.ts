import { describe, expect, it } from "bun:test";
import { checkGrammar } from "../src";

describe("checkGrammar (heuristic, deterministic)", () => {
  it("capitalizes the pronoun I, the sentence start, and adds terminal punctuation", async () => {
    const result = await checkGrammar({ text: "i have two dogs", provider: "heuristic" });
    expect(result.provider).toBe("heuristic");
    expect(result.correctedText).toBe("I have two dogs.");
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("collapses uneven whitespace and capitalizes", async () => {
    const result = await checkGrammar({ text: "hello   world", provider: "heuristic" });
    expect(result.correctedText).toBe("Hello world.");
  });

  it("is deterministic for identical input", async () => {
    const a = await checkGrammar({ text: "the cat sat", provider: "heuristic" });
    const b = await checkGrammar({ text: "the cat sat", provider: "heuristic" });
    expect(a.correctedText).toBe(b.correctedText);
    expect(a.correctedText).toBe("The cat sat.");
  });

  it("reports no issues for already-correct text", async () => {
    const result = await checkGrammar({ text: "This is fine.", provider: "heuristic" });
    expect(result.correctedText).toBe("This is fine.");
    expect(result.issues.length).toBe(0);
    expect(result.summary).toContain("No grammar issues");
  });
});
