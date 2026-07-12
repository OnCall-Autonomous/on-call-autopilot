import { z, type ZodType } from "zod";
import { diagnosisOutput } from "../orchestrator/contracts";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;
const MODEL_PRICING_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

export const readOnlyAgent = z.enum(["COMMANDER", "DIAGNOSER"]);
export type ReadOnlyAgent = z.infer<typeof readOnlyAgent>;

export const commanderOutput = z.object({
  summary: z.string().min(1),
  nextAction: z.enum(["DIAGNOSE", "ESCALATE"]),
  rationale: z.string().min(1),
  diagnosisInputSummary: z.string().min(1),
});

const openAIResponse = z.object({
  model: z.string().min(1),
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({ content: z.string().min(1) }),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }),
});

export const modelErrorCode = z.enum([
  "MODEL_CONFIGURATION_ERROR",
  "MODEL_TIMEOUT",
  "MODEL_RATE_LIMITED",
  "MODEL_AUTHENTICATION_FAILED",
  "MODEL_PROVIDER_ERROR",
  "MODEL_RESPONSE_INVALID",
]);
export type ModelErrorCode = z.infer<typeof modelErrorCode>;

export class ModelClientError extends Error {
  constructor(public readonly code: ModelErrorCode, message: string) {
    super(message);
    this.name = "ModelClientError";
  }
}

export interface ModelRequest {
  agent: ReadOnlyAgent;
  model: string;
  promptVersion: string;
  input: unknown;
  temperature?: number;
  maxTokens?: number;
}

export interface ModelResult<T> {
  output: T;
  provider: "openai";
  model: string;
  promptVersion: string;
  inputSummary: string;
  outputSummary: string;
  tokens: number;
  cost: number;
  latencyMs: number;
}

interface ClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const schemas = {
  COMMANDER: commanderOutput,
  DIAGNOSER: diagnosisOutput,
} satisfies Record<ReadOnlyAgent, ZodType>;

const jsonSchemas: Record<ReadOnlyAgent, Record<string, unknown>> = {
  COMMANDER: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string", minLength: 1 },
      nextAction: { type: "string", enum: ["DIAGNOSE", "ESCALATE"] },
      rationale: { type: "string", minLength: 1 },
      diagnosisInputSummary: { type: "string", minLength: 1 },
    },
    required: ["summary", "nextAction", "rationale", "diagnosisInputSummary"],
  },
  DIAGNOSER: {
    type: "object", additionalProperties: false,
    properties: {
      rootCause: { type: "string", minLength: 1 }, confidence: { type: "number", minimum: 0, maximum: 1 },
      evidence: { type: "array", minItems: 2, items: { type: "object", additionalProperties: false, properties: { source: { type: "string", enum: ["log", "deployment", "commit", "code", "runbook", "research"] }, summary: { type: "string" }, ref: { type: "string" } }, required: ["source", "summary", "ref"] } },
      affectedSurfaces: { type: "array", items: { type: "string" } }, risk: { type: "string", enum: ["low", "medium", "high"] },
      recommendedRepair: { type: "string" }, requiredFiles: { type: "array", items: { type: "string" } },
      dependencyChange: { type: "boolean" }, migrationChange: { type: "boolean" }, secretChange: { type: "boolean" },
    },
    required: ["rootCause", "confidence", "evidence", "affectedSurfaces", "risk", "recommendedRepair", "requiredFiles", "dependencyChange", "migrationChange", "secretChange"],
  },
};

const SENSITIVE_KEY = /^(authorization|cookie|password|secret|token|api[-_]?key)$/i;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const CREDENTIAL_ASSIGNMENT = /\b(api[-_]?key|password|secret|token)\s*[:=]\s*[^\s,;}]+/gi;

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(BEARER_VALUE, "Bearer [REDACTED]").replace(CREDENTIAL_ASSIGNMENT, "$1=[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item)]));
  }
  return value;
}

function summarize(value: unknown): string {
  const safeValue = redact(value);
  const text = typeof safeValue === "string" ? safeValue : JSON.stringify(safeValue);
  return text.replace(/\s+/g, " ").slice(0, 1_000);
}

function systemPrompt(agent: ReadOnlyAgent, promptVersion: string): string {
  const role = agent === "COMMANDER"
    ? "Plan the next read-only incident investigation step. Never propose or perform writes."
    : "Diagnose from supplied evidence only. Cite at least two evidence records. Never claim to have changed a system.";
  return `${role} Prompt version: ${promptVersion}. Return only JSON matching the supplied schema. Never include secrets.`;
}

function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = Object.entries(MODEL_PRICING_USD_PER_MILLION).find(([modelPrefix]) => model.startsWith(modelPrefix))?.[1];
  if (!pricing) return 0;
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}

function providerError(status: number): ModelClientError {
  if (status === 401 || status === 403) return new ModelClientError("MODEL_AUTHENTICATION_FAILED", "OpenAI authentication failed");
  if (status === 429) return new ModelClientError("MODEL_RATE_LIMITED", "OpenAI rate limit exceeded");
  return new ModelClientError("MODEL_PROVIDER_ERROR", `OpenAI request failed with status ${status}`);
}

export function createOpenAIClient(options: ClientOptions) {
  if (!options.apiKey) throw new ModelClientError("MODEL_CONFIGURATION_ERROR", "OPENAI_API_KEY is required");
  const requestFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async generate<T>(request: ModelRequest): Promise<ModelResult<T>> {
      const agent = readOnlyAgent.parse(request.agent);
      const model = process.env[`OPENAI_MODEL_${agent}`] || request.model;
      const startedAt = Date.now();
      let response: Response;
      try {
        response = await requestFetch(OPENAI_URL, {
          method: "POST",
          headers: { Authorization: "Bearer " + options.apiKey, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt(agent, request.promptVersion) },
              { role: "user", content: JSON.stringify(request.input) },
            ],
            temperature: request.temperature ?? 0,
            max_tokens: request.maxTokens,
            response_format: { type: "json_schema", json_schema: { name: `${agent.toLowerCase()}_output`, strict: true, schema: jsonSchemas[agent] } },
          }),
        });
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
          throw new ModelClientError("MODEL_TIMEOUT", "OpenAI request timed out");
        }
        throw new ModelClientError("MODEL_PROVIDER_ERROR", "OpenAI request failed");
      }
      if (!response.ok) throw providerError(response.status);

      try {
        const envelope = openAIResponse.parse(await response.json());
        if (envelope.choices[0].finish_reason === "error") throw new Error("provider finish error");
        const output = schemas[agent].parse(JSON.parse(envelope.choices[0].message.content)) as T;
        return {
          output, provider: "openai", model: envelope.model, promptVersion: request.promptVersion,
          inputSummary: summarize(request.input), outputSummary: summarize(output),
          tokens: envelope.usage.total_tokens,
          cost: calculateCost(envelope.model, envelope.usage.prompt_tokens, envelope.usage.completion_tokens),
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        if (error instanceof ModelClientError) throw error;
        throw new ModelClientError("MODEL_RESPONSE_INVALID", "OpenAI returned an invalid structured response");
      }
    },
  };
}
