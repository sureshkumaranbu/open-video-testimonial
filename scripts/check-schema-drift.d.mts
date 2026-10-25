export function checkSchemaDrift(opts?: { schema?: string; dir?: string; cwd?: string }): {
  ok: boolean;
  output: string;
  generated: string[];
};
