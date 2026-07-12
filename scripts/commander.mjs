/**
 * scripts/commander.mjs — the always-on detector that turns one curl into an
 * autonomous recovery you watch on the dashboard.
 *
 * It does two things and nothing else:
 *   1. Serves POST /break — deploys the REAL pricing code-regression to main and
 *      redeploys the Worker (delegates to `demo.mjs break`). Your single trigger.
 *   2. Polls guarded production /api/checkout. The instant it sees a 5xx with no
 *      recovery already in flight, it launches `demo.mjs recover`, which creates
 *      the incident and drives PR → merge → redeploy → INDEPENDENT verify →
 *      RESOLVED (or ESCALATED on the 20-minute deadline). Every step streams to
 *      Convex, so the UI narrates it live.
 *
 * The Commander never fabricates a recovery: it only decides WHEN to run the
 * proven pipeline. Recovery is proven solely by demo.mjs's independent HTTP
 * verify (HERMES.md invariant).
 *
 * Usage (env from .env.local):
 *   node --env-file=.env.local scripts/commander.mjs
 *   # then, to break prod and watch it self-heal:
 *   curl -XPOST http://localhost:8790/break
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const env = process.env;
const PROD = (env.GUARDED_PRODUCTION_URL || "").replace(/\/+$/, "");
const PORT = Number(env.COMMANDER_PORT || 8790);
const POLL_MS = Number(env.COMMANDER_POLL_MS || 3000);
const DEADLINE_MS = Number(env.RECOVER_DEADLINE_MS || 20 * 60_000);
// Hard backstop: kill a recover child that outlives the deadline + grace. The
// child self-escalates first; this only fires if the process itself hangs.
const CHILD_KILL_MS = DEADLINE_MS + 60_000;
const CHECKOUT_PAYLOAD = { items: [{ id: "sku_1", qty: 2 }], userId: "u_123" };

if (!PROD) throw new Error("GUARDED_PRODUCTION_URL is required in .env.local");

let busy = false; // a break or recover child is running — suppresses the detector
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(msg) {
  console.log(`[commander ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// Run demo.mjs as a child, inheriting stdio so its timeline prints here too.
function runPipeline(command, { killMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn("node", ["--env-file=.env.local", "scripts/demo.mjs", command], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    let killer;
    if (killMs) {
      killer = setTimeout(() => {
        log(`child '${command}' exceeded ${(killMs / 60000).toFixed(0)}m — killing`);
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      }, killMs);
    }
    child.on("close", (code) => {
      if (killer) clearTimeout(killer);
      resolve(code ?? 1);
    });
    child.on("error", (e) => {
      if (killer) clearTimeout(killer);
      log(`child '${command}' failed to start: ${e.message}`);
      resolve(1);
    });
  });
}

async function checkoutStatus() {
  try {
    const res = await fetch(`${PROD}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CHECKOUT_PAYLOAD),
    });
    return res.status;
  } catch {
    return 0; // network blip — treat as unknown, do not trigger
  }
}

// ---- Detector loop ----------------------------------------------------------
async function detectorLoop() {
  log(`watching ${PROD}/api/checkout every ${POLL_MS}ms (deadline ${(DEADLINE_MS / 60000).toFixed(0)}m)`);
  while (!stopping) {
    if (!busy) {
      const status = await checkoutStatus();
      if (status >= 500) {
        busy = true;
        log(`prod → ${status}. Launching autonomous recovery…`);
        const code = await runPipeline("recover", { killMs: CHILD_KILL_MS });
        log(`recovery finished (exit ${code}). Back to watching.`);
        busy = false;
      }
    }
    await sleep(POLL_MS);
  }
  log("stopping.");
}

// ---- Break endpoint ---------------------------------------------------------
const server = createServer((req, res) => {
  const path = (req.url || "").split("?")[0].replace(/\/+$/, "") || "/";
  if (req.method === "POST" && path === "/break") {
    if (busy) {
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "a recovery is already in progress" }));
      return;
    }
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, injecting: "code-regression", watch: "the dashboard" }));
    busy = true;
    log("POST /break — deploying pricing code-regression to prod…");
    runPipeline("break").then((code) => {
      log(`break finished (exit ${code}). Detector will pick up the 5xx.`);
      busy = false; // detector now sees the 500 and auto-recovers
    });
    return;
  }
  if (req.method === "GET" && path === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ service: "on-call-commander", prod: PROD, busy }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: `no route for ${req.method} ${path}` }));
});

server.listen(PORT, () => {
  log(`break trigger ready → curl -XPOST http://localhost:${PORT}/break`);
  detectorLoop();
});
