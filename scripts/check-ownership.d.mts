export type Package = { name: string; owns?: string[]; stubs?: string[]; shared?: string[] };
export type Manifest = {
  base: string;
  frozen?: { files: string[] };
  milestones: Record<string, { name: string; packages: string[]; requirements: string[] }>;
  concurrent: { name: string; packages: string[] }[];
  packages: Record<string, Package>;
};
export const MANIFEST: string;
export function expandBraces(glob: string): string[];
export function globToRegExp(glob: string): RegExp;
export function matcher(globs?: string[]): (file: string) => boolean;
export function loadManifest(file?: string): Manifest;
export function packageMatcher(pkg: Package): (file: string) => boolean;
export function unownedFiles(manifest: Manifest, id: string, files: string[]): string[];
export function ownersOf(manifest: Manifest, file: string): string[];
export function validateManifest(manifest: Manifest, files?: string[]): string[];
