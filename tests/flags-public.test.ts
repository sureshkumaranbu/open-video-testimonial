import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as BoosterGo } from "@/app/b/[project]/[booster]/go/[link]/route";
import EmbedFormPage from "@/app/embed/[slug]/form/[form]/page";
import FormPage from "@/app/f/[project]/[form]/page";
import WallImage from "@/app/wall/[slug]/[wall]/opengraph-image";
import WallSlugPage from "@/app/wall/[slug]/[wall]/page";
import { GET as boosterPage } from "@/app/b/[project]/[booster]/route";
import { createBooster, updateBooster } from "@/lib/boosters";
import { createForm } from "@/lib/forms";
import { createProject, getProjectById } from "@/lib/testimonials";
import { createWall, updateWall } from "@/lib/walls";
import { params, useTempDataDir } from "./helpers";

/**
 * B-04 (decided 2026-10-30): a section's flag switched off stops its public
 * pages too, as /t/ and /cs/ already did: named walls (walls), step-by-step
 * forms and their iframe (forms), and review booster pages (booster).
 */

let ctx: ReturnType<typeof useTempDataDir>;
beforeEach(() => {
  ctx = useTempDataDir();
});
afterEach(() => {
  delete process.env.PLAUDIT_FEATURES;
  ctx.cleanup();
});

/** What a page does: "404" when it calls notFound(), otherwise "shown" (a render or a redirect). */
async function outcome(render: () => Promise<unknown>) {
  try {
    await render();
    return "shown";
  } catch (err) {
    const digest = String((err as { digest?: string }).digest ?? "");
    if (digest.endsWith(";404")) return "404";
    if (digest.startsWith("NEXT_REDIRECT")) return "shown";
    throw err;
  }
}

function setUp() {
  const project = createProject({ name: "Acme", slug: "acme" });
  const row = getProjectById(project.id)!;
  const form = createForm(project.id, { name: "Stories", slug: "stories" });
  const wall = createWall(row, { name: "Love" });
  updateWall(wall.id, { published: true });
  const booster = createBooster(row, { name: "Reviews" });
  updateBooster(booster.id, { published: true, links: [{ id: "g", platform: "google", label: "", url: "https://example.com/review", formId: null }] });
  return { form, wall, booster };
}

const pages = (s: ReturnType<typeof setUp>) => ({
  wall: () => outcome(() => WallSlugPage({ params: Promise.resolve({ slug: "acme", wall: s.wall.slug }), searchParams: Promise.resolve({}) })),
  wallImage: async () => ((await WallImage({ params: Promise.resolve({ slug: "acme", wall: s.wall.slug }) })) as Response).status,
  form: () => outcome(() => FormPage({ params: Promise.resolve({ project: "acme", form: "stories" }), searchParams: Promise.resolve({}) })),
  embedForm: () => outcome(() => EmbedFormPage({ params: Promise.resolve({ slug: "acme", form: "stories" }), searchParams: Promise.resolve({}) })),
  booster: async () => (await boosterPage(new Request(`http://localhost/b/acme/${s.booster.slug}`), params({ project: "acme", booster: s.booster.slug }))).status,
  boosterGo: async () => (await BoosterGo(new Request(`http://localhost/b/acme/${s.booster.slug}/go/g`), params({ project: "acme", booster: s.booster.slug, link: "g" }))).status,
});

describe("B-04 public pages follow their section's flag", () => {
  it("FORM-01 WALL-01 BOOST-01 named walls, forms and boosters are public while their flags are on", async () => {
    const p = pages(setUp());
    expect(await p.wall()).toBe("shown");
    expect(await p.wallImage()).toBe(200);
    expect(await p.form()).toBe("shown");
    expect(await p.embedForm()).toBe("shown");
    expect(await p.booster()).toBe(200);
    expect(await p.boosterGo()).toBe(302);
  });

  it("FORM-01 WALL-01 BOOST-01 with their flags off they answer the same 404 as a missing one (B-04)", async () => {
    const p = pages(setUp());
    process.env.PLAUDIT_FEATURES = "inbox2,widgets";
    expect(await p.wall()).toBe("404");
    expect(await p.wallImage()).toBe(404);
    expect(await p.form()).toBe("404");
    expect(await p.embedForm()).toBe("404");
    expect(await p.booster()).toBe(404);
    expect(await p.boosterGo()).toBe(404);
  });
});
