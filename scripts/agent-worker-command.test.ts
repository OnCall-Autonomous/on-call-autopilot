import { describe, expect, it } from "vitest";
import { buildHermesInvocation } from "./agent-worker-command.mjs";

const baseRun = {
  _id: "run_123",
  incidentId: "incident_123",
  inputSummary: "Fix the checkout regression",
};

describe("agent worker Hermes invocation", () => {
  it("gives Fixer the scoped tools and instructions needed to merge and deploy a passing PR", () => {
    const invocation = buildHermesInvocation({ ...baseRun, agent: "FIXER" }, "on-call-autopilot");

    expect(invocation.args).toContain("on-call-autopilot-implementation,github-pr-workflow");
    expect(invocation.args).toContain("terminal,file");
    expect(invocation.prompt).toContain("gh pr create --draft");
    expect(invocation.prompt).toContain("gh pr merge --squash --delete-branch");
    expect(invocation.prompt).toContain("npm run deploy");
    expect(invocation.prompt).toContain("verify the exact incident request");
  });

  it("keeps non-Fixer specialists on the safe toolset", () => {
    const invocation = buildHermesInvocation({ ...baseRun, agent: "DIAGNOSER" }, "on-call-autopilot");

    expect(invocation.args).toContain("safe");
    expect(invocation.args).not.toContain("terminal,file");
    expect(invocation.prompt).not.toContain("gh pr create");
  });
});
