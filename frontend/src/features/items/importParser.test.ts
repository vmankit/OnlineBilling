import { describe, expect, it } from 'vitest';
import { parseCsv, splitCsvLine } from './importParser';

describe('splitCsvLine', () => {
  it('keeps a quoted comma inside one field', () => {
    // Real product names carry commas; naive splitting tore the row in half.
    expect(splitCsvLine('AP-01,"Asian Paints Apex, 20L",Paint')).toEqual([
      'AP-01',
      'Asian Paints Apex, 20L',
      'Paint',
    ]);
  });

  it('unescapes a doubled quote', () => {
    expect(splitCsvLine('X,"CPVC 1"" pipe",Plumbing')).toEqual(['X', 'CPVC 1" pipe', 'Plumbing']);
  });

  it('keeps empty fields in place', () => {
    expect(splitCsvLine('a,,c')).toEqual(['a', '', 'c']);
  });
});

describe('parseCsv', () => {
  it('reads columns by header name, in any order', () => {
    const csv = [
      'Name,Brand,Selling Price,Unit,Item Code',
      'Apex Ultima 20L,Asian Paints,11400,LITRE,AP-APEXULT',
    ].join('\n');

    const { rows } = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Apex Ultima 20L',
      brand: 'Asian Paints',
      selling_price: 11400,
      stock_unit: 'LITRE',
      item_code: 'AP-APEXULT',
    });
  });

  it('never invents an MRP or an HSN code', () => {
    const csv = ['Item Code,Name,Selling Price', 'X-1,Wall Putty,760'].join('\n');
    const { rows } = parseCsv(csv);
    // The old importer wrote mrp = selling x 1.15 and hsn = '8481'.
    expect(rows[0]!.mrp).toBe(0);
    expect(rows[0]!.hsn_code).toBe('');
  });

  it('tolerates money formatting', () => {
    const csv = ['Name,Purchase Price,Selling Price', 'Nail 2 inch,"Rs 1,250.50","1,499"'].join('\n');
    const { rows } = parseCsv(csv);
    expect(rows[0]!.purchase_price).toBe(1250.5);
    expect(rows[0]!.selling_price).toBe(1499);
  });

  it('falls back to column order when there is no header', () => {
    const csv = 'GN-1,Wire Nail,Hardware,Generic,KG,72,95';
    const { rows } = parseCsv(csv);
    expect(rows[0]).toMatchObject({
      item_code: 'GN-1',
      name: 'Wire Nail',
      stock_unit: 'KG',
      purchase_price: 72,
      selling_price: 95,
    });
  });

  it('counts rows it could not use instead of importing blanks', () => {
    const csv = ['Item Code,Name', 'A-1,Good item', 'A-2,', ',,'].join('\n');
    const { rows, skipped } = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});
