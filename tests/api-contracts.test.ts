import { describe, expect, it } from "vitest";
import { parseCreateIncidentRequest, parseApprovalRequest, publicErrorMessage } from "../src/api/contracts";
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

  it("normalizes wrapped Convex idempotency conflicts for the public API", () => {
    expect(publicErrorMessage(new Error(
      "Uncaught Error: IDEMPOTENCY_KEY_PAYLOAD_CONFLICT\n    at handler (../convex/incidents.ts:7:18)",
    ))).toBe("IDEMPOTENCY_KEY_PAYLOAD_CONFLICT");
  });

  it("preserves other public request errors", () => {
    expect(publicErrorMessage(new Error("INVALID_PROJECT"))).toBe("INVALID_PROJECT");
    expect(publicErrorMessage("invalid error value")).toBe("INVALID_REQUEST");
  });

  it("does not expose unexpected internal errors", () => {
    const internal = "provider secret at ../convex/incidents.ts:7:18";
    const message = publicErrorMessage(new Error(internal));
    expect(message).toBe("INVALID_REQUEST");
    expect(message).not.toContain("provider secret");
    expect(message).not.toContain("convex/incidents.ts");
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
