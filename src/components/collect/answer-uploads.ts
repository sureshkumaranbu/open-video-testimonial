import { ResumableUpload, type UploadState } from "@/lib/resumable-upload";

/**
 * Who owns an answer's video upload. The recorder used to own it and aborted
 * it when it left the page, so on a step-by-step form a recording was lost the
 * moment the person moved to the next step. Now one controller per question
 * holds the take and its ResumableUpload; the recorder only drives it. The
 * upload is aborted only on "Record again", when the take is removed or the
 * file refused, or when the whole form is abandoned (abortAll).
 */

export type RecordedVideo = { blob: Blob; upload: ResumableUpload };

export interface AnswerUploadController {
  /** The kept take, if any: what a recorder shows when it comes back. */
  readonly take: RecordedVideo | null;
  /** The current upload's progress (null before one starts). */
  readonly state: UploadState | null;
  /** Starts a new upload for a new take, aborting the one before. */
  begin(size?: number): ResumableUpload;
  /** The take is complete (recording stopped, file picked): keep it with the current upload. */
  keep(blob: Blob): RecordedVideo | null;
  /** Drops the take and asks the server to throw its bytes away. */
  discard(): void;
  /** Calls `fn` whenever the take or its progress changes; returns the unsubscribe. */
  subscribe(fn: () => void): () => void;
}

export function createAnswerUpload(o: { createUrl: string }): AnswerUploadController {
  let upload: ResumableUpload | null = null;
  let take: RecordedVideo | null = null;
  let state: UploadState | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  return {
    get take() {
      return take;
    },
    get state() {
      return state;
    },
    begin(size) {
      void upload?.abort();
      take = null;
      const next: ResumableUpload = new ResumableUpload({
        createUrl: o.createUrl,
        size,
        onProgress: (s) => {
          // Progress from an upload that was replaced since doesn't count.
          if (upload !== next) return;
          state = s;
          notify();
        },
      });
      upload = next;
      state = next.state;
      notify();
      return next;
    },
    keep(blob) {
      if (!upload) return null;
      take = { blob, upload };
      notify();
      return take;
    },
    discard() {
      void upload?.abort();
      upload = null;
      take = null;
      state = null;
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** One controller per question key, made on first use. */
export function createAnswerUploads(createUrl: (questionKey: string) => string) {
  const byKey = new Map<string, AnswerUploadController>();
  return {
    get(key: string): AnswerUploadController {
      let c = byKey.get(key);
      if (!c) {
        c = createAnswerUpload({ createUrl: createUrl(key) });
        byKey.set(key, c);
      }
      return c;
    },
    /** Every question's kept take. */
    takes(): Record<string, RecordedVideo> {
      return Object.fromEntries([...byKey].flatMap(([k, c]) => (c.take ? [[k, c.take]] : [])));
    },
    /** The form was abandoned (or one answer must go): throw the uploads away. */
    abortAll(): void {
      byKey.forEach((c) => c.discard());
    },
  };
}
export type AnswerUploads = ReturnType<typeof createAnswerUploads>;
