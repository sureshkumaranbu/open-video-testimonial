import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { findProjectBySlugOrAlias } from "@/lib/projects";
import { storage } from "@/lib/storage";
import { getWallBySlug, wallConfig, wallItems, wallView, THEME_SWATCHES, parseWallTheme } from "@/lib/walls";

/**
 * WALL-03 link preview (D22): a collage of the wall's title, rating and a
 * few quotes, drawn with next/og. An uploaded cover (PNG or JPEG) takes over
 * the background. Drafts answer 404, like their page. Fonts are TTF files
 * in public/fonts/og/ (satori reads only ttf, otf and woff).
 */

export const dynamic = "force-dynamic";
export const alt = "Testimonials";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

let fontData: Promise<Buffer> | null = null;
const font = () => (fontData ??= readFile(join(process.cwd(), "public/fonts/og/Geist-Regular.ttf")));

const MAX_COVER_BYTES = 6 * 1024 * 1024;

/** The cover as a data URL satori can draw (PNG or JPEG only), else null. */
async function coverData(key: string | null): Promise<string | null> {
  if (!key || !/\.(png|jpe?g)$/i.test(key)) return null;
  const stream = await storage().read(key);
  if (!stream) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > MAX_COVER_BYTES) return null;
    chunks.push(chunk);
  }
  const mime = /\.png$/i.test(key) ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${Buffer.concat(chunks).toString("base64")}`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function Star({ on, color }: { on: boolean; color: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill={on ? "#f2a93b" : color} />
    </svg>
  );
}

export default async function Image({ params }: { params: Promise<{ slug: string; wall: string }> }) {
  const { slug, wall: wallSlug } = await params;
  const found = findProjectBySlugOrAlias(slug);
  const hit = found && getWallBySlug(found.project.id, wallSlug);
  if (!found || !hit || !hit.wall.published) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const { project } = found;
  const wall = hit.wall;
  const cfg = wallConfig(wall);
  const view = wallView(wall, project, { path: "" });
  const quotes = wallItems(wall, { limit: 12 })
    .items.filter((t) => t.text?.trim())
    .slice(0, 3);
  const theme = THEME_SWATCHES[parseWallTheme(wall.theme)];
  const cover = await coverData(wall.coverKey);
  const ink = cover ? "#ffffff" : theme.ink;
  const title = clip(cfg.hero.title || wall.name, 80);
  const avg = view.stats.average;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: theme.bg,
          color: ink,
          fontFamily: "Geist",
          position: "relative",
        }}
      >
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" width={1200} height={630} style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, objectFit: "cover" }} />
        )}
        {cover && <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, background: "rgba(10,12,20,0.55)", display: "flex" }} />}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 28, opacity: 0.75, display: "flex" }}>{clip(project.name, 60)}</div>
          <div style={{ fontSize: 64, lineHeight: 1.05, letterSpacing: -2, display: "flex", maxWidth: 1040 }}>{title}</div>
          {view.stats.count > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30 }}>
              {avg != null && (
                <div style={{ display: "flex", gap: 2 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} on={n <= Math.round(avg)} color={cover ? "rgba(255,255,255,0.35)" : "#d9dce3"} />
                  ))}
                </div>
              )}
              {avg != null && <span>{avg.toFixed(1)}</span>}
              <span style={{ opacity: 0.75 }}>{`${view.stats.count} ${view.stats.count === 1 ? "testimonial" : "testimonials"}`}</span>
            </div>
          )}
        </div>
        {!cover && quotes.length > 0 && (
          <div style={{ display: "flex", gap: 24 }}>
            {quotes.map((t) => (
              <div
                key={t.id}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: 28,
                  background: theme.card,
                  borderRadius: 20,
                  border: `2px solid ${theme.accent}22`,
                  fontSize: 24,
                  lineHeight: 1.35,
                  height: 230,
                }}
              >
                <div style={{ display: "flex" }}>{`“${clip(t.text!.trim().replace(/\s+/g, " "), 120)}”`}</div>
                <div style={{ display: "flex", fontSize: 20, opacity: 0.7 }}>{clip(t.name, 40)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Geist", data: await font(), style: "normal", weight: 400 }],
      // Revalidated on every fetch, so a testimonial taken down leaves the image at once (like /api/media).
      headers: { "Cache-Control": "public, no-cache" },
    },
  );
}
