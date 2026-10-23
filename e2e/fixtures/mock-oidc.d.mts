export function startMockOidc(opts?: {
  port?: number;
  host?: string;
  advertiseHost?: string;
  googleSecret?: string;
  applePublicKey?: string;
  appleTeamId?: string;
  appleKeyId?: string;
}): Promise<{ base: string; issuer: (provider: "google" | "apple") => string; close: () => Promise<void> }>;
