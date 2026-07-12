import { query } from "./_generated/server";
import { v } from "convex/values";

export const overview = query({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, args) => {
    const projects = args.projectId ? [await ctx.db.get(args.projectId)] : await ctx.db.query("projects").collect();
    const incidents = args.projectId
      ? await ctx.db
          .query("incidents")
          .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId!))
          .collect()
      : await ctx.db.query("incidents").collect();
    const active = incidents.filter((x) => !["RESOLVED", "ESCALATED"].includes(x.status));
    const resolved = incidents.filter((x) => x.status === "RESOLVED");
    const durations = resolved.filter((x) => x.resolvedAt).map((x) => x.resolvedAt! - x.startedAt);
    return {
      projects: projects.filter(Boolean),
      metrics: {
        total: incidents.length,
        active: active.length,
        resolved: resolved.length,
        successRate: incidents.length ? resolved.length / incidents.length : 0,
        mttrMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      },
      activeIncidents: active.sort((a, b) => b.startedAt - a.startedAt).slice(0, 20),
    };
  },
});

export const incidentDetail = query({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get(args.incidentId);
    if (!incident) return null;

    const logWindowStart = incident.startedAt - 5_000;
    const logWindowEnd = (incident.resolvedAt ?? Date.now()) + 5_000;
    const [project, runs, steps, observability, events, deployments, verifications, performance, approvals, logs] = await Promise.all([
      ctx.db.get(incident.projectId),
      ctx.db
        .query("agentRuns")
        .withIndex("by_incident", (q) => q.eq("incidentId", args.incidentId))
        .collect(),
      ctx.db
        .query("workflowSteps")
        .withIndex("by_incidentId_and_scheduledAt", (q) => q.eq("incidentId", args.incidentId))
        .order("asc")
        .take(100),
      ctx.db
        .query("observabilityRecords")
        .withIndex("by_incidentId_and_startedAt", (q) => q.eq("incidentId", args.incidentId))
        .order("desc")
        .take(100),
      ctx.db
        .query("events")
        .withIndex("by_incident_time", (q) => q.eq("incidentId", args.incidentId))
        .collect(),
      ctx.db
        .query("deployments")
        .withIndex("by_incident", (q) => q.eq("incidentId", args.incidentId))
        .collect(),
      ctx.db
        .query("verifications")
        .withIndex("by_incident", (q) => q.eq("incidentId", args.incidentId))
        .collect(),
      ctx.db
        .query("performance")
        .withIndex("by_incident", (q) => q.eq("incidentId", args.incidentId))
        .collect(),
      ctx.db
        .query("approvals")
        .withIndex("by_incident", (q) => q.eq("incidentId", args.incidentId))
        .collect(),
      ctx.db
        .query("logs")
        .withIndex("by_project_time", (q) =>
          q.eq("projectId", incident.projectId).gte("timestamp", logWindowStart).lte("timestamp", logWindowEnd),
        )
        .order("asc")
        .take(100),
    ]);
    return { incident, project, runs, steps, observability, events, deployments, verifications, performance, approvals, logs };
  },
});
