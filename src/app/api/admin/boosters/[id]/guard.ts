import { BoosterError, getBooster } from "@/lib/boosters";
import { jsonError } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";

/** The booster and its project, or null (then the route answers 404). */
export function boosterAndProject(id: string) {
  const booster = getBooster(id);
  const project = booster && getProjectById(booster.projectId);
  return booster && project ? { booster, project } : null;
}

/** BoosterError → its status; anything else is rethrown. */
export function boosterError(err: unknown) {
  if (err instanceof BoosterError) return jsonError(err.status, err.message);
  throw err;
}
