#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE'
Usage:
  scripts/run-local.sh setup
  scripts/run-local.sh dev
  scripts/run-local.sh seed
  scripts/run-local.sh check
  scripts/run-local.sh commander
  scripts/run-local.sh agent-worker
  ONCALL_AUTOPILOT_CONFIRM=1 scripts/run-local.sh demo
  ONCALL_AUTOPILOT_CONFIRM=1 scripts/run-local.sh break
  ONCALL_AUTOPILOT_CONFIRM=1 scripts/run-local.sh recover
  scripts/run-local.sh prewarm

Commands:
  setup         Create .env.local if missing and install dependencies.
  dev           Run Convex dev server.
  seed          Seed Convex defaults.
  check         Run typecheck, tests, and skill validation.
  commander     Run the detector and POST /break service on COMMANDER_PORT.
  agent-worker  Run the local Hermes-backed agent worker.
  demo          Run the full break then recover demo.
  break         Deploy the configured checkout regression only.
  recover       Recover the currently broken configured production app.
  prewarm       Clone/install the external checkout-demo deploy workspace.
USAGE
}

ensure_env_file() {
  if [[ -f .env.local ]]; then
    return
  fi

  if [[ -f .env.example ]]; then
    cp .env.example .env.local
    echo "Created .env.local from .env.example. Fill in required values, then rerun this command." >&2
    exit 1
  fi

  echo "Missing .env.local and .env.example." >&2
  exit 1
}

ensure_deps() {
  if [[ -d node_modules ]]; then
    return
  fi

  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
}

env_has_value() {
  local name="$1"
  if [[ -n "${!name:-}" ]]; then
    return 0
  fi
  [[ -f .env.local ]] && grep -Eq "^[[:space:]]*${name}=.+$" .env.local
}

require_env() {
  local missing=()
  local name

  for name in "$@"; do
    if ! env_has_value "$name"; then
      missing+=("$name")
    fi
  done

  if (( ${#missing[@]} )); then
    echo "Missing required values in .env.local: ${missing[*]}" >&2
    exit 1
  fi
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command on PATH: $name" >&2
    exit 1
  fi
}

confirm_external_mutation() {
  if [[ "${ONCALL_AUTOPILOT_CONFIRM:-}" == "1" ]]; then
    return
  fi

  cat >&2 <<'MESSAGE'
This command can modify the configured GitHub repo and deploy the external
Cloudflare Worker. Rerun with ONCALL_AUTOPILOT_CONFIRM=1 when you intend that.
MESSAGE
  exit 1
}

run_demo_command() {
  local demo_command="$1"

  ensure_env_file
  ensure_deps
  require_command node

  case "$demo_command" in
    break)
      confirm_external_mutation
      require_env CONVEX_URL GITHUB_TOKEN GITHUB_OWNER GITHUB_REPO GUARDED_PRODUCTION_URL CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
      ;;
    recover|run)
      confirm_external_mutation
      require_env CONVEX_URL GITHUB_TOKEN GITHUB_OWNER GITHUB_REPO GUARDED_PRODUCTION_URL OPENAI_API_KEY CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
      ;;
    prewarm)
      require_env GITHUB_TOKEN GITHUB_OWNER GITHUB_REPO
      ;;
    *)
      echo "Unknown demo command: $demo_command" >&2
      exit 1
      ;;
  esac

  exec node --env-file=.env.local scripts/demo.mjs "$demo_command"
}

cmd="${1:-dev}"

case "$cmd" in
  -h|--help|help)
    usage
    ;;
  setup)
    ensure_env_file
    ensure_deps
    ;;
  dev)
    ensure_env_file
    ensure_deps
    exec npm run dev
    ;;
  seed)
    ensure_env_file
    ensure_deps
    exec npm run seed
    ;;
  check)
    ensure_deps
    exec npm run check
    ;;
  commander)
    ensure_env_file
    ensure_deps
    require_env GUARDED_PRODUCTION_URL
    exec npm run commander
    ;;
  agent-worker)
    ensure_env_file
    ensure_deps
    require_command hermes
    require_env CONVEX_URL AGENT_WORKER_TOKEN
    exec npm run agent:worker
    ;;
  demo)
    run_demo_command run
    ;;
  break|recover|prewarm)
    run_demo_command "$cmd"
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
