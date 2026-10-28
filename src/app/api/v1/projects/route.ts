import { projectToApi } from "@/lib/api-shape";
import { apiJson, requireApiKey } from "@/lib/api-keys";
import { keyCanAccess } from "@/lib/api-v1";
import { countByStatus, listProjects } from "@/lib/testimonials";

/** GET /api/v1/projects */
export function GET(req: Request) {
  const auth = requireApiKey(req, "read");
  if (auth.error) return auth.error;
  const key = auth.key;
  return apiJson({ data: listProjects().filter((p) => keyCanAccess(key, p.id)).map((p) => ({ ...projectToApi(p), counts: countByStatus(p.id) })) });
}
