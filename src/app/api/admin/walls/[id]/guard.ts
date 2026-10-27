import { getProjectById } from "@/lib/testimonials";
import { getWall } from "@/lib/walls";

/** The wall and its project, or null (then the route answers 404). */
export function wallAndProject(id: string) {
  const wall = getWall(id);
  const project = wall && getProjectById(wall.projectId);
  return wall && project ? { wall, project } : null;
}
