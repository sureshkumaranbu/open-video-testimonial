import { projectToApi } from "@/lib/api-shape";
import { apiJson, requireApiKey } from "@/lib/api-keys";
import { countByStatus, listProjects } from "@/lib/testimonials";

/** GET /api/v1/projects */
export function GET(req: Request) {
  const auth = requireApiKey(req, "read");
  if (auth.error) return auth.error;
  return apiJson({ data: listProjects().map((p) => ({ ...projectToApi(p), counts: countByStatus(p.id) })) });
}
