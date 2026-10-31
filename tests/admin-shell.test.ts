import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { activeSection, projectIdFrom } from "@/app/admin/_shell/nav";
import { adminBootScript, SIDEBAR_KEY } from "@/app/admin/_shell/boot";
import { MODE_KEY } from "@/lib/themes";

const SECTIONS = [
  { id: "testimonials", label: "Testimonials", path: "" },
  { id: "requests", label: "Requests", path: "/requests" },
  { id: "widgets", label: "Widgets", path: "/widgets" },
  { id: "settings", label: "Project settings", path: "/settings" },
];
const ID = "0b7c2f1e-1111-4222-8333-944445555666";

describe("the dashboard shell's navigation", () => {
  it("finds the project in the address", () => {
    expect(projectIdFrom(`/admin/projects/${ID}`)).toBe(ID);
    expect(projectIdFrom(`/admin/projects/${ID}/widgets/w_1`)).toBe(ID);
    expect(projectIdFrom("/admin")).toBeNull();
    expect(projectIdFrom("/admin/settings")).toBeNull();
  });

  it("marks the section the address is in, the longest match winning", () => {
    expect(activeSection(`/admin/projects/${ID}`, SECTIONS)).toBe("testimonials");
    expect(activeSection(`/admin/projects/${ID}/`, SECTIONS)).toBe("testimonials");
    expect(activeSection(`/admin/projects/${ID}/widgets`, SECTIONS)).toBe("widgets");
    expect(activeSection(`/admin/projects/${ID}/widgets/w_abc`, SECTIONS)).toBe("widgets");
    expect(activeSection(`/admin/projects/${ID}/settings`, SECTIONS)).toBe("settings");
    // A section that isn't listed (its feature is off) marks nothing.
    expect(activeSection(`/admin/projects/${ID}/walls`, SECTIONS)).toBeNull();
    expect(activeSection("/admin/settings", SECTIONS)).toBeNull();
  });
});

describe("the dashboard's boot script", () => {
  it("reads the shared colour mode and the sidebar's state, and never throws", () => {
    expect(adminBootScript).toContain(JSON.stringify(MODE_KEY));
    expect(adminBootScript).toContain(JSON.stringify(SIDEBAR_KEY));
    expect(adminBootScript).toMatch(/^\(function\(\)\{.*try\{.*\}catch\(e\)\{\}\}\)\(\);$/);
  });

  it("is rendered with the page's CSP nonce", () => {
    const layout = fs.readFileSync(path.join(__dirname, "..", "src", "app", "admin", "layout.tsx"), "utf8");
    expect(layout).toMatch(/<script nonce=\{nonce\}[^>]*adminBootScript/);
  });
});
