export function buildHermesInvocation(run, profile) {
  const isFixer = run.agent === "FIXER";
  const skills = isFixer
    ? "on-call-autopilot-implementation,github-pr-workflow"
    : "on-call-autopilot-implementation";
  const toolsets = "safe";
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
      "Use only the narrow GitHub gateway: never invoke arbitrary shell, git, gh, deployment, or merge operations.",
      "Proceed only after an accepted diagnosis moves through DIAGNOSIS_REVIEW → PATCHING → PATCH_REVIEW → PR_READY.",
      "The gateway must create a feature branch, apply only allowlisted changes, reject protected paths and size limits, require a changed regression test, run targeted and full tests, commit, push, open a PR, and verify the remote SHA and PR URL.",
      "Stop at PR_READY. Never merge, deploy, or mark the incident resolved automatically.",
      "Return the exact PR URL, local and remote commit SHA, changed files, test commands, and results.",
      "If any policy, test, push, or PR verification gate fails, stop and report the failure without claiming success.",
      "Do not modify the On-Call Autopilot control-plane repository.",
    );
  } else if (run.agent === "DIAGNOSER") {
    promptLines.push(
      "Use only the read-only GitHub gateway to fetch public issue and CI metadata, read allowlisted files, search repository content, create an isolated checkout, and run one bounded allowlisted reproduction command.",
      "Do not write repository files, create branches, commit, push, open PRs, deploy, or merge.",
      "Return a real diagnosis with exact refs, commands, exit codes, and reproducible evidence.",
    );
  }

  return {
    args: [
      "--profile", profile,
      "--skills", skills,
      "chat", "--quiet", "--toolsets", toolsets, "-q", promptLines.join("\n"),
    ],
    prompt: promptLines.join("\n"),
  };
}
