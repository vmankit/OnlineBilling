/**
 * Turns a supplier's price list into rows the import screen can show.
 *
 * Two rules run through this file:
 *
 *  - Nothing is invented. A missing price stays 0 and a missing HSN stays
 *    empty, so the operator can see what still needs filling in. Inventing an
 *    MRP or an HSN code puts numbers on a customer's bill that nobody chose.
 *  - A field the shop typed is read as typed. "Asian Paints Apex, 20L" has a
 *    comma in it; splitting on commas would break that row in half.
 */

export interface ParsedRow {
  item_code: string;
  name: string;
  category: string;
  brand: string;
  stock_unit: string;
  purchase_price: number;
  selling_price: number;
  mrp: number;
  min_stock: number;
  stock: number;
  barcode: string;
  hsn_code: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  /** Rows that had no name, and were therefore unusable. */
  skipped: number;
  headers: string[];
}

/** Header aliases, so a shop's own column names still land in the right field. */
const FIELD_ALIASES: Record<keyof ParsedRow, string[]> = {
  item_code: ['item code', 'item_code', 'code', 'sku', 'article', 'item no', 'itemno'],
  name: ['name', 'item name', 'item', 'product', 'description', 'particulars'],
  category: ['category', 'group', 'item group'],
  brand: ['brand', 'company', 'make'],
  stock_unit: ['unit', 'uom', 'stock unit', 'stock_unit'],
  purchase_price: ['purchase price', 'purchase', 'cost', 'rate', 'purchase_price', 'buy'],
  selling_price: ['selling price', 'sale price', 'sell', 'selling_price', 'sp'],
  mrp: ['mrp', 'max retail price', 'print rate'],
  min_stock: ['min stock', 'minimum', 'min_stock', 'reorder', 'alert'],
  stock: ['stock', 'opening stock', 'qty', 'quantity', 'closing stock'],
  barcode: ['barcode', 'ean', 'upc', 'bar code'],
  hsn_code: ['hsn', 'hsn code', 'hsn_code'],
};

/**
 * Splits one CSV line, honouring quoted fields and doubled quotes inside them.
 * `a,"b,c",d` is three fields, not four.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field.trim());
  return out;
}

/** Reads a number, tolerating "1,250.00", "Rs 1250" and blanks. */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '').replace(/[^0-9.-]/g, '');
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function toText(value: unknown): string {
  return String(value ?? '').trim();
}

/** Maps header names to column positions, falling back to fixed order. */
function buildColumnMap(headers: string[]): Partial<Record<keyof ParsedRow, number>> {
  const normalized = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9 _]/g, '').trim());
  const map: Partial<Record<keyof ParsedRow, number>> = {};

  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<
    [keyof ParsedRow, string[]]
  >) {
    const index = normalized.findIndex((h) => aliases.includes(h));
    if (index >= 0) map[field] = index;
  }
  return map;
}

/** Column order used when the file has no recognisable header row. */
const POSITIONAL: Array<keyof ParsedRow> = [
  'item_code', 'name', 'category', 'brand', 'stock_unit',
  'purchase_price', 'selling_price', 'mrp', 'min_stock', 'barcode', 'hsn_code', 'stock',
];

function rowsFromMatrix(matrix: unknown[][]): ParseResult {
  if (matrix.length === 0) return { rows: [], skipped: 0, headers: [] };

  const headerCells = (matrix[0] ?? []).map(toText);
  const map = buildColumnMap(headerCells);
  const recognised = Object.keys(map).length >= 2;

  // With no usable header the first line is data, read by position.
  const body = recognised ? matrix.slice(1) : matrix;
  const columnFor = (field: keyof ParsedRow): number =>
    recognised ? (map[field] ?? -1) : POSITIONAL.indexOf(field);

  const rows: ParsedRow[] = [];
  let skipped = 0;

  for (const cells of body) {
    const at = (field: keyof ParsedRow): unknown => {
      const index = columnFor(field);
      return index >= 0 ? cells[index] : undefined;
    };

    const name = toText(at('name'));
    if (!name) {
      if (cells.some((c) => toText(c))) skipped++;
      continue;
    }

    rows.push({
      item_code: toText(at('item_code')),
      name,
      category: toText(at('category')),
      brand: toText(at('brand')),
      stock_unit: toText(at('stock_unit')).toUpperCase(),
      purchase_price: toNumber(at('purchase_price')),
      selling_price: toNumber(at('selling_price')),
      // Left at 0 when absent — never derived from the selling price.
      mrp: toNumber(at('mrp')),
      min_stock: toNumber(at('min_stock')),
      stock: toNumber(at('stock')),
      barcode: toText(at('barcode')),
      hsn_code: toText(at('hsn_code')),
    });
  }

  return { rows, skipped, headers: recognised ? headerCells : [] };
}

export function parseCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return rowsFromMatrix(lines.map(splitCsvLine));
}

/**
 * Reads a real spreadsheet. The parser is pulled in only when an .xlsx is
 * actually picked, so a shop that only ever uses CSV never downloads it.
 */
export async function parseSpreadsheet(file: File): Promise<ParseResult> {
  const isCsv = /\.(csv|txt)$/i.test(file.name);
  if (isCsv) return parseCsv(await file.text());

  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { rows: [], skipped: 0, headers: [] };

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName]!, {
    header: 1,
    blankrows: false,
    defval: '',
  });
  return rowsFromMatrix(matrix);
}
