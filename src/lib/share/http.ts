import { jsonError } from "../http";
import { UnsupportedMediaError, UploadError } from "../storage";
import { getProjectById } from "../testimonials";
import { ShareError } from "./render";
import { ShareStoreError } from "./store";

/** The URL's project, or a 404 answer. */
export function projectOr404(id: string) {
  const project = getProjectById(id);
  return project ? { project } : { response: jsonError(404, "Project not found") };
}

/** Known studio errors as answers; anything else is a bug and is thrown on. */
export function shareFail(err: unknown): Response {
  if (err instanceof ShareError || err instanceof ShareStoreError) return jsonError(err.status, err.message);
  if (err instanceof UnsupportedMediaError) return jsonError(415, err.message);
  if (err instanceof UploadError) return jsonError(400, err.message);
  throw err;
}

/** Studio images are the owner's working files: never cached anywhere but this browser tab. */
export const PRIVATE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** "spotlight-1080x1080.png" */
export function imageName(template: string, size: { width: number; height: number }, ext: string, n?: number) {
  return `${template}-${size.width}x${size.height}${n ? `-${n}` : ""}.${ext}`;
}
