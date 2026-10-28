import { jsonError } from "../http";
import { FormVideoError } from "./form-videos";
import { RenderError } from "./renders";

/** A RenderError or FormVideoError → its status and message; anything else is rethrown. */
export function renderErrorResponse(err: unknown) {
  if (err instanceof RenderError || err instanceof FormVideoError) return jsonError(err.status, err.message);
  throw err;
}
