import { getRequestSession } from "@/lib/auth";
import { jsonError, requireRole } from "@/lib/http";
import { decodeUpload } from "@/lib/importers/html";
import { ImportError, previewImport, type PreviewUpload } from "@/lib/importers/run";
import { getProjectById } from "@/lib/testimonials";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function json(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Previews an import: `{adapter, input, options, confirmOwnership: true}` as
 * JSON, or multipart with an `html` (saved page) or `file` (export) upload.
 * Answers 201 with the run and the latest matching items.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const by = getRequestSession(req)?.email;

  let adapter: unknown;
  let input: unknown;
  let options: unknown;
  let confirmOwnership: unknown;
  let upload: PreviewUpload | undefined;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return jsonError(400, "Send the form again");
    adapter = form.get("adapter");
    input = json(form.get("input"));
    options = json(form.get("options"));
    confirmOwnership = form.get("confirmOwnership") === "true";
    const html = form.get("html");
    const file = form.get("file");
    const picked = html instanceof File ? { kind: "html" as const, f: html } : file instanceof File ? { kind: "file" as const, f: file } : null;
    if (!picked) return jsonError(400, "Choose the saved page or file to upload");
    if (picked.f.size === 0) return jsonError(400, "That file is empty");
    if (picked.f.size > MAX_UPLOAD_BYTES) return jsonError(400, "That file is larger than 20 MB");
    upload = { kind: picked.kind, text: decodeUpload(new Uint8Array(await picked.f.arrayBuffer())) };
  } else {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return jsonError(400, "Send the import as JSON");
    ({ adapter, input, options, confirmOwnership } = body);
  }

  try {
    const result = await previewImport(project.id, String(adapter ?? ""), input, options, { confirmOwnership, by, upload });
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ImportError) return Response.json({ error: err.message, code: err.code ?? null }, { status: err.status });
    throw err;
  }
}
