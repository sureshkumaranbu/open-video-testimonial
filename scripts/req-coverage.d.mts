export type TestTitle = { title: string; line: number; file?: string };
export function testTitles(source: string): TestTitle[];
export function collectTitles(root?: string): (TestTitle & { file: string })[];
export function coverage(ids: string[], titles: TestTitle[]): Record<string, TestTitle[]>;
export function requirementsFor(manifest: { milestones: Record<string, { requirements?: string[] }> }, milestone: string): string[];
