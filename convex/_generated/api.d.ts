/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentRuns from "../agentRuns.js";
import type * as agentWorker from "../agentWorker.js";
import type * as approvals from "../approvals.js";
import type * as dashboard from "../dashboard.js";
import type * as demoSeed from "../demoSeed.js";
import type * as events from "../events.js";
import type * as evidence from "../evidence.js";
import type * as http from "../http.js";
import type * as incidents from "../incidents.js";
import type * as logs from "../logs.js";
import type * as models from "../models.js";
import type * as projects from "../projects.js";
import type * as seed from "../seed.js";
import type * as transitions from "../transitions.js";
import type * as workflowSteps from "../workflowSteps.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentRuns: typeof agentRuns;
  agentWorker: typeof agentWorker;
  approvals: typeof approvals;
  dashboard: typeof dashboard;
  demoSeed: typeof demoSeed;
  events: typeof events;
  evidence: typeof evidence;
  http: typeof http;
  incidents: typeof incidents;
  logs: typeof logs;
  models: typeof models;
  projects: typeof projects;
  seed: typeof seed;
  transitions: typeof transitions;
  workflowSteps: typeof workflowSteps;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
