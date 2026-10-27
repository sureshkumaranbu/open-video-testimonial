import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { listAnswers } from "./answers";
import { listHighlights } from "./highlights";
import { historyToJson, listHistory } from "./history";
import { duplicatesOf, mergedInto } from "./merge";
import { getTestimonial } from "./testimonials";

const { testimonialImages, customers, feedback, forms } = schema;

/**
 * Everything the dashboard's detail drawer shows for one testimonial, in one
 * call: the row with its tags, the other answers, images, highlights, the
 * edit history (diffs parsed), the customer, private feedback from the same
 * submission and the form it came through. Owner-only: it includes private
 * fields and answer media keys.
 */
export function getTestimonialDetail(id: string) {
  const testimonial = getTestimonial(id);
  if (!testimonial) return null;
  const db = getDb();
  const images = db
    .select()
    .from(testimonialImages)
    .where(eq(testimonialImages.testimonialId, id))
    .orderBy(asc(testimonialImages.position))
    .all();
  const customer = testimonial.customerId
    ? (db.select().from(customers).where(eq(customers.id, testimonial.customerId)).get() ?? null)
    : null;
  const notes = db.select().from(feedback).where(eq(feedback.testimonialId, id)).orderBy(desc(feedback.createdAt)).all();
  const form = testimonial.formId
    ? (db
        .select({ id: forms.id, name: forms.name, slug: forms.slug, isDefault: forms.isDefault, layout: forms.layout, status: forms.status })
        .from(forms)
        .where(eq(forms.id, testimonial.formId))
        .get() ?? null)
    : null;
  return {
    testimonial,
    answers: listAnswers(id),
    images,
    highlights: listHighlights(id),
    history: listHistory(id).map(historyToJson),
    customer,
    feedback: notes,
    form,
    // INBOX-11: likely duplicates to merge with, and where a merged one went.
    duplicates: testimonial.status === "trashed" ? [] : duplicatesOf(testimonial.projectId, id),
    mergedInto: mergedInto(testimonial),
  };
}

export type TestimonialDetail = NonNullable<ReturnType<typeof getTestimonialDetail>>;
