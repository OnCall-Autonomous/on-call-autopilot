import { describe, expect, it, vi } from "vitest";
import { createOpenAIClient, ModelClientError } from "../src/models/openai-client";

const diagnosis = {
  rootCause: "Database pool exhaustion", confidence: 0.91,
  evidence: [
    { source: "log", summary: "Pool timeout", ref: "log-1" },
    { source: "deployment", summary: "Started after deploy", ref: "deploy-1" },
  ],
  affectedSurfaces: ["checkout"], risk: "medium", recommendedRepair: "Inspect pool lifecycle",
  requiredFiles: ["src/db.ts"], dependencyChange: false, migrationChange: false, secretChange: false,
};

function response(content: unknown, status = 200) {
  return new Response(JSON.stringify(status === 200 ? {
    model: "gpt-4o-mini",
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  } : { error: { message: "failed" } }), { status });
}

describe("OpenAI read-only model client", () => {
  it("sends strict structured output and validates Diagnoser responses", async () => {
    const requestFetch = vi.fn<typeof fetch>(async () => response(diagnosis));
    const client = createOpenAIClient({ apiKey: "test-key", fetch: requestFetch });
    const result = await client.generate<typeof diagnosis>({
      agent: "DIAGNOSER", model: "gpt-4o-mini", promptVersion: "diagnoser-v1",
      input: { incident: "checkout timeout", authorization: "Bearer secret-value" }, maxTokens: 1000,
    });

    expect(result).toMatchObject({ provider: "openai", model: "gpt-4o-mini", tokens: 150, cost: 0.000045 });
    expect(result.output.rootCause).toBe(diagnosis.rootCause);
    expect(result.inputSummary).not.toContain("secret-value");
    expect(result.inputSummary).toContain("[REDACTED]");
    const body = JSON.parse(String(requestFetch.mock.calls[0][1]?.body));
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[0].content).toContain("Never include secrets");
  });

  it("rejects malformed model JSON with a stable error code", async () => {
    const client = createOpenAIClient({ apiKey: "test-key", fetch: async () => response({ rootCause: "Incomplete" }) });
    await expect(client.generate({ agent: "DIAGNOSER", model: "gpt-4o-mini", promptVersion: "diagnoser-v1", input: {} }))
      .rejects.toMatchObject({ code: "MODEL_RESPONSE_INVALID" });
  });

  it("rejects malformed Commander output", async () => {
    const client = createOpenAIClient({ apiKey: "test-key", fetch: async () => response({ summary: "Plan" }) });
    await expect(client.generate({ agent: "COMMANDER", model: "gpt-4o-mini", promptVersion: "commander-v1", input: {} }))
      .rejects.toMatchObject({ code: "MODEL_RESPONSE_INVALID" });
  });

  it("accepts valid Commander output", async () => {
    const output = { summary: "Investigate errors", nextAction: "DIAGNOSE", rationale: "Evidence is incomplete", diagnosisInputSummary: "Inspect bounded logs" };
    const client = createOpenAIClient({ apiKey: "test-key", fetch: async () => response(output) });
    await expect(client.generate({ agent: "COMMANDER", model: "gpt-4o-mini", promptVersion: "commander-v1", input: {} }))
      .resolves.toMatchObject({ output });
  });

  it.each([[401, "MODEL_AUTHENTICATION_FAILED"], [429, "MODEL_RATE_LIMITED"], [500, "MODEL_PROVIDER_ERROR"]])(
    "maps provider status %s to %s", async (status, code) => {
      const client = createOpenAIClient({ apiKey: "test-key", fetch: async () => response({}, status) });
      await expect(client.generate({ agent: "COMMANDER", model: "gpt-4o-mini", promptVersion: "commander-v1", input: {} }))
        .rejects.toMatchObject({ code });
    },
  );

  it("fails closed without configuration", () => {
    expect(() => createOpenAIClient({ apiKey: "" })).toThrow(ModelClientError);
  });
});
