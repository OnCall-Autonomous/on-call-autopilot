/* Temporary local type shim. `npx convex dev` replaces this directory with project-specific generated types. */
import { mutationGeneric, queryGeneric, actionGeneric, internalMutationGeneric, internalQueryGeneric, internalActionGeneric } from "convex/server";

export const mutation = mutationGeneric;
export const query = queryGeneric;
export const action = actionGeneric;
export const internalMutation = internalMutationGeneric;
export const internalQuery = internalQueryGeneric;
export const internalAction = internalActionGeneric;
