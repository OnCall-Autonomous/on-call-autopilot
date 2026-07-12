import { describe, expect, it } from "vitest";
import { buildHermesInvocation } from "./agent-worker-command.mjs";

const baseRun = {
  _id: "run_123",
  incidentId: "incident_123",
  inputSummary: "Fix the checkout regression",
};

describe("agent worker Hermes invocation", () => {
  it("requires Fixer delivery to stop at a verified PR", () => {
    const invocation = buildHermesInvocation({ ...baseRun, agent: "FIXER" }, "on-call-autopilot");

    expect(invocation.args).toContain("safe");
    expect(invocation.args).not.toContain("--yolo");
    expect(invocation.args).not.toContain("terminal,file");
    expect(invocation.prompt).toContain("DIAGNOSIS_REVIEW → PATCHING → PATCH_REVIEW → PR_READY");
    expect(invocation.prompt).toContain("verify the remote SHA and PR URL");
    expect(invocation.prompt).toContain("Never merge");
    expect(invocation.prompt).not.toContain("gh pr merge");
    expect(invocation.prompt).not.toContain("npm run deploy");
  });

  it("gives the Diagnoser read-only GitHub investigation instructions", () => {
    const invocation = buildHermesInvocation({ ...baseRun, agent: "DIAGNOSER" }, "on-call-autopilot");

    expect(invocation.args).toContain("safe");
    expect(invocation.prompt).toContain("public issue and CI metadata");
    expect(invocation.prompt).toContain("isolated checkout");
    expect(invocation.prompt).toContain("bounded allowlisted reproduction command");
    expect(invocation.prompt).toContain("Do not write repository files");
  });

  it("keeps other specialists on the safe toolset", () => {
    const invocation = buildHermesInvocation({ ...baseRun, agent: "VERIFIER" }, "on-call-autopilot");

    expect(invocation.args).toContain("safe");
    expect(invocation.prompt).not.toContain("open a PR");
  });
});
