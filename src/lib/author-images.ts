import { fileInUse } from "./projects";
import { deleteObject, removeFiles, saveUpload } from "./storage";
import { getTestimonial, updateTestimonial, type TestimonialWithTags } from "./testimonials";

/**
 * The person's photo and their company logo on a testimonial (INBOX-08).
 * Both are public media once approved (D13). The file is stored first, then
 * the key goes through updateTestimonial, so the change is in the edit
 * history and sends `testimonial.updated` like any other edit.
 */

export const AUTHOR_IMAGES = { avatar: "avatarKey", logo: "companyLogoKey" } as const;
export type AuthorImage = keyof typeof AUTHOR_IMAGES;

export function isAuthorImage(v: string): v is AuthorImage {
  // Own keys only: `in` would also accept "constructor" or "toString".
  return Object.hasOwn(AUTHOR_IMAGES, v);
}

/**
 * Replaces (a file) or removes (null) the photo or logo. saveUpload checks
 * the size and sniffs the bytes (PNG, JPEG, WebP or GIF; never SVG). The old
 * file is deleted unless another row still uses it (a manual add shares the
 * photo with the customer record). Null when the testimonial is gone.
 */
export async function setAuthorImage(id: string, which: AuthorImage, file: File | null, opts: { by?: string } = {}): Promise<TestimonialWithTags | null> {
  const column = AUTHOR_IMAGES[which];
  const existing = getTestimonial(id);
  if (!existing) return null;
  const old = existing[column];
  if (!file && !old) return existing;
  const stored = file ? await saveUpload(file, "image") : null;
  const key = stored?.key ?? null;
  const updated = updateTestimonial(id, which === "avatar" ? { avatarKey: key } : { companyLogoKey: key }, { by: opts.by });
  if (!updated) {
    await deleteObject(stored?.key).catch(() => undefined);
    return null;
  }
  if (old && old !== key && !fileInUse(old)) await removeFiles([old]);
  return updated;
}
