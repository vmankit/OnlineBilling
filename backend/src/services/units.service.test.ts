import { describe, expect, it } from 'vitest';
import { convertUnits, resolveStockQuantity, type UnitRow } from './units.service.js';

const unit = (code: string, dimension: string, factor: number): UnitRow => ({
  code, name: code, dimension, factor_to_base: factor, is_base: factor === 1, decimals: 4,
});

const METER = unit('METER', 'LENGTH', 1);
const FEET = unit('FEET', 'LENGTH', 0.3048);
const KG = unit('KG', 'WEIGHT', 1);
const GRAM = unit('GRAM', 'WEIGHT', 0.001);
const LITRE = unit('LITRE', 'VOLUME', 1);
const ML = unit('ML', 'VOLUME', 0.001);
const PCS = unit('PCS', 'COUNT', 1);
const BOX = unit('BOX', 'COUNT', 1);

describe('convertUnits', () => {
  it('returns the amount unchanged for the same unit', () => {
    expect(convertUnits(7.5, METER, METER)).toBe(7.5);
  });

  it('deducts 0.3048 m when one foot is sold from metre stock', () => {
    expect(convertUnits(1, FEET, METER)).toBe(0.3048);
  });

  it('converts metres to feet at 3.28084', () => {
    expect(convertUnits(1, METER, FEET)).toBeCloseTo(3.2808, 4);
  });

  it('handles weight and volume sub-units', () => {
    expect(convertUnits(500, GRAM, KG)).toBe(0.5);
    expect(convertUnits(2.5, KG, GRAM)).toBe(2500);
    expect(convertUnits(750, ML, LITRE)).toBe(0.75);
  });

  it('refuses to convert across dimensions without an override', () => {
    expect(() => convertUnits(1, KG, METER)).toThrow(/different things/);
  });

  it('uses an item-scoped override ahead of a global one', () => {
    const overrides = [
      { item_id: null, from_unit: 'BOX', to_unit: 'PCS', factor: 10 },
      { item_id: 'item-1', from_unit: 'BOX', to_unit: 'PCS', factor: 12 },
    ];
    expect(convertUnits(2, BOX, PCS, overrides)).toBe(24);
  });

  it('applies an override in reverse when only the forward row exists', () => {
    const overrides = [{ item_id: null, from_unit: 'BOX', to_unit: 'PCS', factor: 12 }];
    expect(convertUnits(24, PCS, BOX, overrides)).toBe(2);
  });
});

describe('resolveStockQuantity', () => {
  it('consumes pack_size x quantity of the stock unit for a packaged sale', () => {
    // 2 tins of "20 L" from an item stocked in LITRE
    expect(
      resolveStockQuantity({
        quantity: 2, soldUnit: PCS, packSize: 20, packUnit: LITRE, stockUnit: LITRE,
      }),
    ).toBe(40);
  });

  it('converts a loose sale in a different unit of the same dimension', () => {
    // 10 feet cut from a pipe stocked in metres
    expect(
      resolveStockQuantity({
        quantity: 10, soldUnit: FEET, packSize: 1, packUnit: METER, stockUnit: METER,
      }),
    ).toBe(3.048);
  });

  it('leaves piece-count items alone', () => {
    expect(
      resolveStockQuantity({
        quantity: 3, soldUnit: PCS, packSize: 1, packUnit: PCS, stockUnit: PCS,
      }),
    ).toBe(3);
  });

  it('expands a box into loose pieces via an override', () => {
    expect(
      resolveStockQuantity({
        quantity: 2, soldUnit: BOX, packSize: 1, packUnit: BOX, stockUnit: PCS,
        overrides: [{ item_id: null, from_unit: 'BOX', to_unit: 'PCS', factor: 50 }],
      }),
    ).toBe(100);
  });
});
