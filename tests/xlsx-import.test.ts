import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as xlsxRoute } from "@/app/api/admin/projects/[id]/import-csv/xlsx/route";
import { POST as previewRoute } from "@/app/api/admin/projects/[id]/import-csv/preview/route";
import { importCsv, previewCsv } from "@/lib/csv-import";
import { createProject, getProjectById, listTestimonials } from "@/lib/testimonials";
import { isDateFormat, readXlsx, rowsToCsv, serialToDate, XlsxError } from "@/lib/xlsx";
import { adminHeaders, params, useTempDataDir } from "./helpers";

const FIX = path.resolve(__dirname, "fixtures/xlsx");
const fixture = (name: string) => fs.readFileSync(path.join(FIX, name));

/** A minimal zip writer for hand-made spreadsheets (stored or deflated parts). */
function zip(files: { name: string; data: string | Buffer; store?: boolean }[]) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const body = f.store ? raw : zlib.deflateRawSync(raw);
    const name = Buffer.from(f.name, "utf8");
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(f.store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(f.store ? 0 : 8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    central.push(dir, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const sheet = (rows: string) => `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

const send = (body: BodyInit, headers: Record<string, string> = {}) =>
  xlsxRoute(new Request(`http://localhost/api/admin/projects/${projectId}/import-csv/xlsx`, { method: "POST", headers: { ...adminHeaders(), ...headers }, body }), params({ id: projectId }));

describe("IMP-04 reading .xlsx", () => {
  it("IMP-04 reads the first sheet: shared strings, numbers, dates, times and text that only looks like a formula", () => {
    const { rows, truncated } = readXlsx(fixture("openpyxl.xlsx"));
    expect(truncated).toBe(false);
    expect(rows[0]).toEqual(["Name", "Email", "Company", "Testimonial", "Rating", "Date", "Tags"]);
    expect(rows[1]).toEqual(["Rowan Field", "rowan@example.com", "Field & Co", "Setup took five minutes.\nSupport answered within the hour.", "5", "2026-03-14", "support, onboarding"]);
    expect(rows[2].slice(3, 6)).toEqual(['We use it on every launch page now, "no regrets".', "4", "2026-09-01 14:30"]);
    // The blank row is dropped; a string starting with "=" stays words.
    expect(rows[3][0]).toBe("Lee Okafor");
    expect(rows[3][3]).toBe("=SUM(1,2) is not a formula here, just words");
    expect(rows[4]).toEqual(["Sam", "", "", "1234567.5", "3"]);
    expect(rows).toHaveLength(5);
  });

  it("IMP-04 reads a file LibreOffice saved", () => {
    const { rows } = readXlsx(fixture("libreoffice.xlsx"));
    expect(rows[0]).toEqual(["Name", "Testimonial", "Rating", "Date"]);
    expect(rows[1].slice(0, 3)).toEqual(["Ada Lovelace", 'Commas, quotes " and all', "5"]);
    expect(rows[1][3]).toBe("2026-10-01");
    expect(rows[2]).toEqual(["Grace Hopper", "It just works.", "4", "2025-01-31"]);
  });

  it("IMP-04 inline strings, skipped columns, booleans, stored parts and the 1904 date system", () => {
    const file = zip([
      { name: "xl/workbook.xml", data: '<workbook xmlns:r="r"><workbookPr date1904="1"/><sheets><sheet name="A" sheetId="1" r:id="rId9"/></sheets></workbook>', store: true },
      { name: "xl/_rels/workbook.xml.rels", data: '<Relationships><Relationship Id="rId9" Target="worksheets/data.xml"/></Relationships>' },
      { name: "xl/styles.xml", data: '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd&quot;/&quot;mm&quot;/&quot;yyyy"/><numFmt numFmtId="165" formatCode="0.00&quot;d&quot;"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>' },
      {
        name: "xl/worksheets/data.xml",
        data: sheet(
          '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="C1" t="inlineStr"><is><r><t>Te</t></r><r><t>xt</t></r></is></c><c r="D1" t="inlineStr"><is><t>When</t></is></c><c r="E1" t="inlineStr"><is><t>N</t></is></c></row>' +
            '<row r="2"><c r="A2" t="inlineStr"><is><t>Ada &amp; co</t></is></c><c r="C2" t="b"><v>1</v></c><c r="D2" s="1"><v>0</v></c><c r="E2" s="2"><v>0.1</v></c></row>',
        ),
      },
    ]);
    expect(readXlsx(file).rows).toEqual([
      ["Name", "", "Text", "When", "N"],
      ["Ada & co", "", "TRUE", "1904-01-01", "0.1"],
    ]);
  });

  it("IMP-04 converts date serials the way spreadsheets count them", () => {
    expect(serialToDate(1)).toBe("1900-01-01");
    expect(serialToDate(59)).toBe("1900-02-28");
    expect(serialToDate(61)).toBe("1900-03-01");
    expect(serialToDate(45000)).toBe("2023-03-15");
    expect(serialToDate(45000.5)).toBe("2023-03-15 12:00");
    expect(serialToDate(0, true)).toBe("1904-01-01");
    expect(serialToDate(-1)).toBeNull();
    expect(isDateFormat("yyyy-mm-dd")).toBe(true);
    expect(isDateFormat('0.00"d"')).toBe(false);
    expect(isDateFormat("[Red]#,##0")).toBe(false);
    expect(isDateFormat("h:mm AM/PM")).toBe(true);
  });

  it("IMP-04 refuses zip bombs, oversized parts and damaged files while reading", () => {
    const zeros = Buffer.alloc(4 * 1024 * 1024);
    const bomb = zip([{ name: "xl/worksheets/sheet1.xml", data: zeros }]);
    expect(bomb.length).toBeLessThan(20_000);
    expect(() => readXlsx(bomb)).toThrow(/too large/);
    expect(() => readXlsx(Buffer.from("PK\x03\x04 not really a zip"))).toThrow(XlsxError);
    expect(() => readXlsx(Buffer.from("name,text\n"))).toThrow(/isn't an .xlsx/);
    expect(() => readXlsx(zip([{ name: "xl/other.xml", data: "<x/>" }]))).toThrow(/no worksheet/);
  });

  it("IMP-04 a shared string used by every cell can't blow up the output", () => {
    const big = "x".repeat(40_000);
    const strings = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>${big}</t></si></sst>`;
    const one = readXlsx(zip([{ name: "xl/worksheets/sheet1.xml", data: sheet('<row><c t="s"><v>0</v></c></row>') }, { name: "xl/sharedStrings.xml", data: strings }]));
    expect(one.rows[0][0]).toHaveLength(32_767);
    const cells = Array.from({ length: 100 }, () => '<c t="s"><v>0</v></c>').join("");
    const rows = Array.from({ length: 1_100 }, () => `<row>${cells}</row>`).join("");
    expect(() => readXlsx(zip([{ name: "xl/worksheets/sheet1.xml", data: sheet(rows) }, { name: "xl/sharedStrings.xml", data: strings }]))).toThrow(/too large/);
  });

  it("IMP-04 keeps at most 10,000 rows and 100 columns and says so", () => {
    const many = Array.from({ length: 10_005 }, (_, i) => `<row><c t="inlineStr"><is><t>p${i}</t></is></c></row>`).join("");
    const wide = `<row>${Array.from({ length: 105 }, (_, i) => `<c t="inlineStr"><is><t>c${i}</t></is></c>`).join("")}</row>`;
    const tall = readXlsx(zip([{ name: "xl/worksheets/sheet1.xml", data: sheet(many) }]));
    expect(tall.rows).toHaveLength(10_001);
    expect(tall.truncated).toBe(true);
    const broad = readXlsx(zip([{ name: "xl/worksheets/sheet1.xml", data: sheet(wide) }]));
    expect(broad.rows[0]).toHaveLength(100);
    expect(broad.truncated).toBe(true);
  });
});

describe("IMP-04 spreadsheets and pasted tables in the CSV mapper", () => {
  it("IMP-04 an .xlsx goes through the same mapping, preview and warnings as a CSV", async () => {
    const res = await send(new Uint8Array(fixture("openpyxl.xlsx")), { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    expect(res.status).toBe(200);
    const { csv, rows } = await res.json();
    expect(rows).toBe(4);
    const preview = previewCsv(csv);
    expect(preview.mapping).toMatchObject({ name: "Name", email: "Email", text: "Testimonial", rating: "Rating", date: "Date", tags: "Tags" });
    expect(preview.total).toBe(4);
    expect(preview.warnings.map((w) => w.message).join(" ")).toMatch(/Rating "9" isn't 1 to 5 stars/);
    expect(preview.warnings.map((w) => w.message).join(" ")).toMatch(/Date "soon"/);
    const result = importCsv(getProjectById(projectId)!, csv, {});
    expect(result.imported).toBe(4);
    const rowan = listTestimonials(projectId).find((t) => t.authorName === "Rowan Field")!;
    expect(rowan).toMatchObject({ rating: 5, authorEmail: "rowan@example.com", authorCompany: "Field & Co" });
    expect(rowan.tags).toEqual(["onboarding", "support"]);
  });

  it("IMP-04 a table pasted from a spreadsheet (tab-separated, with a quoted line break) previews the same way", async () => {
    const pasted = 'Name\tTestimonial\tStars\nAda Lovelace\t"Two lines,\nstill one cell"\t5\nGrace\tSimple\t4\n';
    const res = await previewRoute(
      new Request(`http://localhost/api/admin/projects/${projectId}/import-csv/preview`, { method: "POST", headers: { ...adminHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ csv: pasted }) }),
    );
    const preview = await res.json();
    expect(preview.mapping).toMatchObject({ name: "Name", text: "Testimonial", rating: "Stars" });
    expect(preview.valid).toBe(2);
    expect(preview.rows[0].text).toBe("Two lines,\nstill one cell");
  });

  it("IMP-04 the spreadsheet route refuses other files, empty ones and ones over 20 MB", async () => {
    expect((await send("name,text\nA,B")).status).toBe(400);
    expect((await send(new Uint8Array(0))).status).toBe(400);
    expect((await send(new Uint8Array(10), { "content-length": String(21 * 1024 * 1024) })).status).toBe(413);
    const unauth = await xlsxRoute(new Request(`http://localhost/x`, { method: "POST", body: "x" }), params({ id: projectId }));
    expect(unauth.status).toBe(401);
  });

  it("IMP-04 rowsToCsv keeps every value as it is, quotes included", () => {
    expect(rowsToCsv([["a", 'b "c"'], ["=1"]])).toBe('"a","b ""c"""\r\n"=1",""\r\n');
  });
});
