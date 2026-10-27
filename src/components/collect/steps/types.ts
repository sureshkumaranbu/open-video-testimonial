import type { Answers } from "@/lib/forms/engine";
import type { LabelKey, Labels } from "@/lib/forms/labels";
import type { PublicForm } from "@/lib/forms/schema";
import type { AnswerUploads } from "../answer-uploads";

/** Files the runner keeps beside the answers, so they survive moving between steps. */
export type RunnerFiles = {
  photo: File | null;
  logo: File | null;
  images: Record<string, File[]>;
};

/** What every step gets from the runner. */
export type StepCtx = {
  state: Answers;
  update: (fn: (s: Answers) => Answers) => void;
  errors: Record<string, string>;
  labels: Labels;
  /** A label with {project} and the given values filled in. */
  t: (key: LabelKey, values?: Record<string, string | number>) => string;
  project: { name: string; slug: string };
  form: PublicForm;
  files: RunnerFiles;
  setFiles: (fn: (f: RunnerFiles) => RunnerFiles) => void;
  uploads: AnswerUploads;
  limits: { maxVideoBytes: number; maxImageBytes: number };
  /** The builder's preview: no camera, nothing sent. */
  preview: boolean;
  /** Prefilled details the person can't change. */
  locked: string[];
  /** Jumps to a step (the review page's Edit links). */
  goToPage: (pageIndex: number) => void;
};
