/**
 * Minimal RFC 4180 CSV reading and writing: quoted fields, doubled quotes,
 * line breaks inside quotes, CRLF, and a leading byte-order mark.
 */
export function parseCsv(input: string, delimiter = detectDelimiter(input)): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Picks comma, semicolon or tab, whichever appears most in the first line. */
export function detectDelimiter(input: string) {
  const first = input.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const [best, count] = [",", ";", "\t"]
    .map((d) => [d, first.split(d).length - 1] as const)
    .sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : ",";
}

/** Rows as objects keyed by the header row. */
export function parseCsvRecords(input: string) {
  const [header, ...rows] = parseCsv(input);
  if (!header) return { headers: [] as string[], records: [] as Record<string, string>[] };
  const headers = header.map((h) => h.trim());
  return {
    headers,
    records: rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))),
  };
}

function cell(value: unknown) {
  let s = value === null || value === undefined ? "" : String(value);
  // Spreadsheet apps run cells starting with these as formulas; neutralise them.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
