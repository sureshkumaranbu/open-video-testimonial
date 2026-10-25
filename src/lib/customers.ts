import type { Tx } from "@/db";
import type { Customer } from "@/db/schema";

/**
 * Customers: one row per person per project, so repeat testimonials share
 * their details. Contract published by WP1.1; WP1.2 owns and implements it.
 */

export type CustomerInput = {
  /** Lower-cased before it's stored; without one a new row is always added. */
  email?: string;
  name: string;
  title?: string;
  company?: string;
  website?: string;
  avatarKey?: string;
  socials?: Record<string, string>;
};

/** Finds the project's customer by email or adds one. Only fills blanks: details already saved are never overwritten. */
export function upsertCustomer(projectId: string, p: CustomerInput, tx?: Tx): Customer | null {
  throw new Error("not implemented: upsertCustomer");
}
