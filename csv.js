// CSV parser with delimiter detection based on the header row.
// A comma-separated file may legitimately contain semicolons inside a cell,
// e.g. "admittedly; to be sure". Only the selected delimiter is structural.
export function parseCSV(input) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  if (!text.trim()) return [];

  const firstLine = text.split(/\r\n|\n|\r/).find(line => line.trim()) || '';
  const delimiter = detectDelimiter(firstLine);
  const rows = [];
  let row = [], cell = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && quoted && text[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  if (!rows.length) return [];

  const headers = rows.shift().map(value => value.trim().toLowerCase().replace(/^\uFEFF/, ''));
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()])));
}

function detectDelimiter(line) {
  const candidates = [',', ';', '\t'];
  const counts = new Map(candidates.map(delimiter => [delimiter, 0]));
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && quoted && line[i + 1] === '"') i++;
    else if (c === '"') quoted = !quoted;
    else if (!quoted && counts.has(c)) counts.set(c, counts.get(c) + 1);
  }
  return candidates.sort((a, b) => counts.get(b) - counts.get(a))[0];
}

// Quote every exported cell and neutralize spreadsheet formula prefixes.
// The apostrophe is intentionally visible in spreadsheet applications and
// prevents user-supplied text from being interpreted as a formula.
export function escapeCSVCell(value) {
  let text = String(Array.isArray(value) ? value.join('; ') : (value ?? ''));
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
