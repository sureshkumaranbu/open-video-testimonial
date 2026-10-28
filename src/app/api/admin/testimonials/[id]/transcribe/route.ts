import { jsonError, requireRole } from "@/lib/http";
import { ffmpegAvailable } from "@/lib/media";
import { getTestimonial } from "@/lib/testimonials";
import { queueTranscription, transcriptionEnabled } from "@/lib/transcribe";

/** Queues (or re-runs) speech-to-text for a video testimonial. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const t = getTestimonial(id);
  if (!t) return jsonError(404, "Testimonial not found");
  if (!t.videoKey) return jsonError(400, "This testimonial has no video");
  if (!transcriptionEnabled()) return jsonError(409, "Transcription isn't set up on this server (see TRANSCRIBE_PROVIDER)");
  if (!(await ffmpegAvailable())) return jsonError(409, "Transcription needs ffmpeg, which isn't installed");
  queueTranscription(id);
  return Response.json({ testimonial: getTestimonial(id) });
}
