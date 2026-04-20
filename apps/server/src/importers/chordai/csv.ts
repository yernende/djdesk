export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text.trimEnd());

  if (rows.length === 0) {
    return [];
  }

  const [headers, ...dataRows] = rows;

  if (!headers || headers.length === 0) {
    return [];
  }

  return dataRows
    .filter((row) => row.some((cell) => cell.length > 0))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(cell);
      rows.push(row);
      cell = "";
      row = [];
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);

  return rows;
}
