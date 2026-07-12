import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const convexUrl = process.env.CONVEX_URL;
const token = process.env.AGENT_WORKER_TOKEN;
const profile = process.env.HERMES_PROFILE || "on-call-autopilot";
const pollMs = Number(process.env.AGENT_WORKER_POLL_MS || 2000);
const runTimeoutMs = Number(process.env.AGENT_RUN_TIMEOUT_MS || 20 * 60_000);
const once = process.env.AGENT_WORKER_ONCE === "1";

if (!convexUrl) throw new Error("CONVEX_URL is required in .env.local");
if (!token) throw new Error("AGENT_WORKER_TOKEN is required in .env.local and Convex");
if (!Number.isFinite(runTimeoutMs) || runTimeoutMs <= 0) throw new Error("AGENT_RUN_TIMEOUT_MS must be positive");

const client = new ConvexHttpClient(convexUrl);
const workerId = `local-${process.pid}-${randomUUID().slice(0, 8)}`;
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runHermes(run) {
  const prompt = [
    `You are the ${run.agent} specialist for On-Call Autopilot.`,
    `Incident ID: ${run.incidentId}`,
    `Agent run ID: ${run._id}`,
    `Task: ${run.inputSummary}`,
    "Follow the on-call-autopilot-implementation skill and project HERMES.md.",
    "Return a concise structured result. Never include credentials or authorization headers.",
  ].join("\n");

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn("hermes", [
      "--profile", profile,
      "--skills", "on-call-autopilot-implementation",
      "chat", "--quiet", "--toolsets", "safe", "-q", prompt,
    ], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, runTimeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - started;
      if (timedOut) {
        const partial = stdout.trim() || "No partial result was returned before timeout.";
        reject(Object.assign(new Error("Agent run exceeded the 20 minute limit"), {
          durationMs, timedOut: true,
          output: `Unable to complete within 20 minutes. Partial work:\n${partial}`,
        }));
        return;
      }
      if (code === 0 && stdout.trim()) resolve({ output: stdout.trim(), durationMs });
      else reject(Object.assign(new Error(stderr.trim() || `Hermes exited with code ${code}`), { durationMs }));
    });
  });
}

async function processRun(run) {
  console.log(`[agent-worker] claimed ${run.agent} run ${run._id}`);
  const heartbeat = setInterval(() => {
    client.mutation(api.agentWorker.heartbeat, { token, workerId, runId: run._id }).catch((error) =>
      console.error(`[agent-worker] heartbeat failed: ${error.message}`),
    );
  }, 30_000);
  try {
    const result = await runHermes(run);
    await client.mutation(api.agentWorker.complete, {
      token, workerId, runId: run._id, outputSummary: result.output.slice(0, 8_000), durationMs: result.durationMs,
    });
    console.log(`[agent-worker] completed ${run._id} in ${result.durationMs}ms`);
  } catch (error) {
    const durationMs = Number(error.durationMs || 0);
    if (error.timedOut) {
      await client.mutation(api.agentWorker.revoke, {
        token, workerId, runId: run._id,
        outputSummary: String(error.output).slice(0, 8_000), durationMs,
      });
    } else {
      await client.mutation(api.agentWorker.fail, {
        token, workerId, runId: run._id, errorCode: "HERMES_EXECUTION_FAILED",
        outputSummary: String(error.message || error).slice(0, 8_000), durationMs,
      });
    }
    console.error(`[agent-worker] failed ${run._id}: ${error.message || error}`);
  } finally {
    clearInterval(heartbeat);
  }
}

console.log(`[agent-worker] started ${workerId}; polling ${convexUrl}; timeout ${runTimeoutMs}ms`);
do {
  const run = await client.mutation(api.agentWorker.claimNext, { token, workerId });
  if (run) await processRun(run);
  else if (!once) await sleep(pollMs);
} while (!stopping && !once);
console.log("[agent-worker] stopped");
