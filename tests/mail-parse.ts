/**
 * Just enough RFC 5322 parsing for tests: unfolded, lower-cased headers and a
 * decoded single-part text body (7bit or quoted-printable).
 */
function decodeWords(value: string) {
  return value.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_m, _charset, enc: string, text: string) =>
    enc.toUpperCase() === "B"
      ? Buffer.from(text, "base64").toString("utf8")
      : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_x, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8"),
  );
}

function decodeQuotedPrintable(body: string) {
  const bytes = body
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(bytes, "latin1").toString("utf8");
}

export async function simpleParser(raw: string) {
  const split = raw.search(/\r?\n\r?\n/);
  const head = raw.slice(0, split).replace(/\r?\n[ \t]+/g, " ");
  const body = raw.slice(split).replace(/^\r?\n\r?\n/, "");
  const headers: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = decodeWords(line.slice(i + 1).trim());
  }
  const qp = /quoted-printable/i.test(headers["content-transfer-encoding"] ?? "");
  const text = (qp ? decodeQuotedPrintable(body) : body).replace(/\r\n/g, "\n");
  return { headers, subject: headers.subject, from: headers.from, text };
}
