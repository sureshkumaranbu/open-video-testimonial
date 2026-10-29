export function extensionFiles(dir?: string): [string, Buffer][];
export function firefoxManifest(chrome: Record<string, unknown> & { background: { service_worker: string } }, id?: string): Record<string, unknown>;
export function zip(entries: [string, Buffer][]): Buffer;
export function build(out?: string): { chrome: string; firefox: string; files: number; version: string };
