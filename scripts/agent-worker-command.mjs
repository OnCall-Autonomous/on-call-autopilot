export function buildHermesInvocation(run, profile) {
  const isFixer = run.agent === "FIXER";
  const skills = isFixer
    ? "on-call-autopilot-implementation,github-pr-workflow"
    : "on-call-autopilot-implementation";
  const toolsets = isFixer ? "terminal,file" : "safe";
  const promptLines = [
    `You are the ${run.agent} specialist for On-Call Autopilot.`,
    `Incident ID: ${run.incidentId}`,
    `Agent run ID: ${run._id}`,
    `Task: ${run.inputSummary}`,
    "Follow the on-call-autopilot-implementation skill and project HERMES.md.",
    "Return a concise structured result. Never include credentials or authorization headers.",
  ];

  if (isFixer) {
    promptLines.push(
      "Use git and the authenticated gh CLI to make the smallest safe fix in the guarded repository.",
      "Create a new fix branch, add a regression test, run the relevant tests, commit, push, and run gh pr create --draft.",
      "If and only if all required tests pass, mark the PR ready and run gh pr merge --squash --delete-branch.",
      "After a successful merge, check out the merged default branch and run npm run deploy with the configured backend credentials.",
      "After deployment, verify the exact incident request against production and inspect fresh health and application logs.",
      "Return the exact PR URL, merge commit SHA, deployment ID and URL, changed files, tests, and production verification evidence.",
      "If tests, merge, deployment, or production verification fail, stop and report the failure; never claim success or resolution.",
      "Do not modify the On-Call Autopilot control-plane repository.",
    );
  }

  return {
    args: [
      "--profile", profile,
      "--skills", skills,
      ...(isFixer ? ["--yolo"] : []),
      "chat", "--quiet", "--toolsets", toolsets, "-q", promptLines.join("\n"),
    ],
    prompt: promptLines.join("\n"),
  };
}
