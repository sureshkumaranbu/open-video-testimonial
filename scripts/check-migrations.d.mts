export const BREAKPOINT: string;
export const ADDITIVE_FROM: number;
export const RELEASED: Record<string, { when: number; sha256: string }>;
export function checkMigrations(dir?: string): string[];
