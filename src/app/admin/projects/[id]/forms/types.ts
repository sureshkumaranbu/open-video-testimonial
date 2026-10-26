import type { AdminForm } from "@/lib/forms/admin";

/** A form as the dashboard receives it over JSON (dates are strings). */
export type FormRow = Omit<AdminForm, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };
