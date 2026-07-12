let sdk;
let tracing;
let langfuseState = { enabled: false, reason: "not_initialized" };

const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(sk|pk|org|sess|ghp|github_pat|xoxb|cf)_[A-Za-z0-9._~+/=-]{12,}\b/g,
];

function mask(data) {
  let out = String(data);
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  out = out.replace(
    /("?(?:api[_-]?key|token|authorization|secret|password)"?\s*[:=]\s*")([^"]+)(")/gi,
    "$1[REDACTED]$3",
  );
  return out;
}

function shortError(error) {
  return error instanceof Error ? error.message : String(error);
}

export function langfuseRuntimeStatus() {
  return langfuseState;
}

export async function initLangfuse() {
  if (langfuseState.reason !== "not_initialized") return langfuseState;
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    langfuseState = { enabled: false, reason: "missing_credentials" };
    return langfuseState;
  }

  try {
    const [otel, langfuseOtel, langfuseTracing] = await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@langfuse/otel"),
      import("@langfuse/tracing"),
    ]);
    const { NodeSDK } = otel;
    const { LangfuseSpanProcessor } = langfuseOtel;
    sdk = new NodeSDK({
      spanProcessors: [
        new LangfuseSpanProcessor({
          mask: ({ data }) => mask(data),
        }),
      ],
    });
    sdk.start();
    tracing = langfuseTracing;
    langfuseState = { enabled: true, reason: "configured" };
    return langfuseState;
  } catch (error) {
    langfuseState = { enabled: false, reason: `sdk_unavailable:${shortError(error)}` };
    return langfuseState;
  }
}

export async function shutdownLangfuse() {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = undefined;
}

export function langfuseTraceUrl(traceId) {
  if (!traceId) return undefined;
  const template = process.env.LANGFUSE_TRACE_URL_TEMPLATE;
  if (template && template.includes("{traceId}")) return template.replaceAll("{traceId}", traceId);
  const projectUrl = process.env.LANGFUSE_PROJECT_URL;
  if (projectUrl) return `${projectUrl.replace(/\/+$/, "")}/traces/${traceId}`;
  return undefined;
}

function localObservation() {
  return {
    enabled: false,
    update() {},
    traceId() {
      return undefined;
    },
    observationId() {
      return undefined;
    },
  };
}

export async function withLangfuseObservation(name, options, fn) {
  if (!langfuseState.enabled || !tracing) return fn(localObservation());

  return tracing.startActiveObservation(
    name,
    async (observation) => {
      const handle = {
        enabled: true,
        update(update) {
          observation.update(update);
        },
        traceId() {
          return tracing.getActiveTraceId?.();
        },
        observationId() {
          return tracing.getActiveSpanId?.();
        },
      };
      return fn(handle);
    },
    options,
  );
}
