import { describe, expect, it } from "vitest";
import { parseCreateIncidentRequest, parseApprovalRequest } from "../src/api/contracts";
import { DEFAULT_MODEL_PROFILES, resolveModelProfile } from "../src/models/model-profiles";

describe("UI API contracts", () => {
  it("accepts a valid dashboard incident request", () => {
    expect(parseCreateIncidentRequest({
      projectId: "project_123",
      service: "checkout",
      mode: "AUTO_RESOLVE",
      severity: "SEV2",
      idempotencyKey: "ui-incident-1",
    })).toMatchObject({ source: "dashboard", configuredMode: "AUTO_RESOLVE" });
  });

  it("rejects an unsupported autonomy mode", () => {
    expect(() => parseCreateIncidentRequest({ projectId: "p", service: "checkout", mode: "UNSAFE" })).toThrow();
  });

  it("requires an actor for approval decisions", () => {
    expect(() => parseApprovalRequest({ decision: "APPROVED" })).toThrow();
  });
});

describe("model profiles", () => {
  it("assigns reasoning models only to LLM agents", () => {
    expect(resolveModelProfile("DIAGNOSER", DEFAULT_MODEL_PROFILES).model).toBeTruthy();
    expect(resolveModelProfile("PERFORMANCE", DEFAULT_MODEL_PROFILES).kind).toBe("deterministic");
  });

  it("fails closed when an agent profile is absent", () => {
    expect(() => resolveModelProfile("FIXER", [])).toThrow("MODEL_PROFILE_NOT_CONFIGURED");
  });
});
