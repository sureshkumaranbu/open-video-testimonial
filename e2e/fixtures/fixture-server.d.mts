export type RecordedRequest = {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json?: unknown;
  at: string;
};
export type CannedResponse = {
  path: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string | object;
  delayMs?: number;
  times?: number;
};
export function startFixtureServer(opts?: { port?: number; host?: string; root?: string }): Promise<{
  url: string;
  port: number;
  requests: (prefix?: string) => RecordedRequest[];
  reset: () => void;
  close: () => Promise<void>;
}>;
