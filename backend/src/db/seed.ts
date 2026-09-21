import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { closePool, withTransaction } from './pool.js';
import { runMigrations } from './migrate.js';

// ---------------------------------------------------------------- units
// factor_to_base converts 1 <unit> into the dimension's base unit.
const UNITS: Array<[code: string, name: string, dimension: string, factor: number, isBase: boolean, dp: number]> = [
  ['PCS',   'Pieces',      'COUNT',  1,         true,  0],
  ['BOX',   'Box',         'COUNT',  1,         false, 0],
  ['BAG',   'Bag',         'COUNT',  1,         false, 0],
  ['PACK',  'Pack',        'COUNT',  1,         false, 0],
  ['SET',   'Set',         'COUNT',  1,         false, 0],
  ['KG',    'Kilogram',    'WEIGHT', 1,         true,  3],
  ['GRAM',  'Gram',        'WEIGHT', 0.001,     false, 0],
  ['LITRE', 'Litre',       'VOLUME', 1,         true,  3],
  ['ML',    'Millilitre',  'VOLUME', 0.001,     false, 0],
  ['METER', 'Meter',       'LENGTH', 1,         true,  3],
  ['FEET',  'Feet',        'LENGTH', 0.3048,    false, 2],
  ['INCH',  'Inch',        'LENGTH', 0.0254,    false, 2],
];

const ROLES: Array<[string, string]> = [
  ['ADMIN', 'Administrator'],
  ['MANAGER', 'Manager'],
  ['CASHIER', 'Cashier'],
];

const CATEGORIES = ['Hardware', 'Plumbing', 'Electrical', 'Paint', 'Tools', 'Fittings'];
const BRANDS = ['Asian Paints', 'Birla Opus', 'JK Paints', 'Nerolac', 'Astral', 'Havells', 'Bosch', 'Generic'];
const GROUPS = ['Emulsion Paint', 'Primer & Putty', 'Pipes', 'Wires & Cables', 'Power Tools', 'Sanitary'];

interface SeedVariant {
  name: string; sku: string; barcode: string; packSize: number; packUnit: string;
  purchase: number; selling: number; mrp: number; minStock: number; opening: number; isDefault?: boolean;
}
interface SeedItem {
  name: string; code: string; brand: string; category: string; group?: string;
  /** Product classification only — not printed on bills. */
  hsn: string; tax: number; stockUnit: string; variants: SeedVariant[];
}

const ITEMS: SeedItem[] = [
  {
    name: 'Asian Paints Apex Ultima Exterior Emulsion', code: 'AP-APEXULT', brand: 'Asian Paints',
    category: 'Paint', group: 'Emulsion Paint', hsn: '3209', tax: 0, stockUnit: 'LITRE',
    variants: [
      { name: '1 L',  sku: 'AP-APEXULT-1L',  barcode: '8901234500011', packSize: 1,  packUnit: 'LITRE', purchase: 520,  selling: 640,  mrp: 720,  minStock: 10, opening: 24 },
      { name: '4 L',  sku: 'AP-APEXULT-4L',  barcode: '8901234500028', packSize: 4,  packUnit: 'LITRE', purchase: 1980, selling: 2450, mrp: 2760, minStock: 20, opening: 60 },
      { name: '10 L', sku: 'AP-APEXULT-10L', barcode: '8901234500035', packSize: 10, packUnit: 'LITRE', purchase: 4750, selling: 5900, mrp: 6600, minStock: 20, opening: 40 },
      { name: '20 L', sku: 'AP-APEXULT-20L', barcode: '8901234500042', packSize: 20, packUnit: 'LITRE', purchase: 9200, selling: 11400, mrp: 12800, minStock: 40, opening: 400, isDefault: true },
    ],
  },
  {
    name: 'Asian Paints Royale Luxury Interior Emulsion', code: 'AP-ROYALE', brand: 'Asian Paints',
    category: 'Paint', group: 'Emulsion Paint', hsn: '3209', tax: 0, stockUnit: 'LITRE',
    variants: [
      { name: '1 L',  sku: 'AP-ROYALE-1L',  barcode: '8901234500059', packSize: 1,  packUnit: 'LITRE', purchase: 610,  selling: 760,  mrp: 860,  minStock: 10, opening: 30 },
      { name: '4 L',  sku: 'AP-ROYALE-4L',  barcode: '8901234500066', packSize: 4,  packUnit: 'LITRE', purchase: 2340, selling: 2900, mrp: 3280, minStock: 16, opening: 48, isDefault: true },
      { name: '20 L', sku: 'AP-ROYALE-20L', barcode: '8901234500073', packSize: 20, packUnit: 'LITRE', purchase: 11200, selling: 13800, mrp: 15600, minStock: 40, opening: 160 },
    ],
  },
  {
    name: 'Birla Opus Wall Putty', code: 'BO-PUTTY', brand: 'Birla Opus',
    category: 'Paint', group: 'Primer & Putty', hsn: '3214', tax: 0, stockUnit: 'KG',
    variants: [
      { name: '1 KG',  sku: 'BO-PUTTY-1',  barcode: '8901234510018', packSize: 1,  packUnit: 'KG', purchase: 32,   selling: 42,   mrp: 48,   minStock: 20,  opening: 50 },
      { name: '5 KG',  sku: 'BO-PUTTY-5',  barcode: '8901234510025', packSize: 5,  packUnit: 'KG', purchase: 150,  selling: 198,  mrp: 225,  minStock: 50,  opening: 200 },
      { name: '20 KG', sku: 'BO-PUTTY-20', barcode: '8901234510032', packSize: 20, packUnit: 'KG', purchase: 580,  selling: 760,  mrp: 860,  minStock: 100, opening: 600, isDefault: true },
      { name: '40 KG', sku: 'BO-PUTTY-40', barcode: '8901234510049', packSize: 40, packUnit: 'KG', purchase: 1120, selling: 1480, mrp: 1680, minStock: 80,  opening: 400 },
    ],
  },
  {
    name: 'JK Paints Wall Primer Water Based', code: 'JK-PRIMER', brand: 'JK Paints',
    category: 'Paint', group: 'Primer & Putty', hsn: '3208', tax: 0, stockUnit: 'LITRE',
    variants: [
      { name: '4 L',  sku: 'JK-PRIMER-4L',  barcode: '8901234520017', packSize: 4,  packUnit: 'LITRE', purchase: 720,  selling: 920,  mrp: 1050, minStock: 16, opening: 40, isDefault: true },
      { name: '10 L', sku: 'JK-PRIMER-10L', barcode: '8901234520024', packSize: 10, packUnit: 'LITRE', purchase: 1700, selling: 2200, mrp: 2500, minStock: 20, opening: 60 },
    ],
  },
  {
    name: 'Nerolac Beauty Smooth Interior Emulsion', code: 'NL-BEAUTY', brand: 'Nerolac',
    category: 'Paint', group: 'Emulsion Paint', hsn: '3209', tax: 0, stockUnit: 'LITRE',
    variants: [
      { name: '1 L',  sku: 'NL-BEAUTY-1L',  barcode: '8901234530016', packSize: 1,  packUnit: 'LITRE', purchase: 340, selling: 430,  mrp: 490,  minStock: 10, opening: 20 },
      { name: '10 L', sku: 'NL-BEAUTY-10L', barcode: '8901234530023', packSize: 10, packUnit: 'LITRE', purchase: 3100, selling: 3900, mrp: 4400, minStock: 20, opening: 80, isDefault: true },
    ],
  },
  {
    // Stocked in METER. Sold by the foot at the counter — the unit conversion
    // system deducts 0.3048 m per foot, never a flat 1.
    name: 'Astral CPVC Pipe 1 inch SDR-11', code: 'AS-CPVC-1', brand: 'Astral',
    category: 'Plumbing', group: 'Pipes', hsn: '3917', tax: 0, stockUnit: 'METER',
    variants: [
      { name: 'Per Meter', sku: 'AS-CPVC-1-M',  barcode: '8901234540015', packSize: 1, packUnit: 'METER', purchase: 210, selling: 268, mrp: 300, minStock: 50, opening: 480, isDefault: true },
      { name: '3 M Length', sku: 'AS-CPVC-1-3M', barcode: '8901234540022', packSize: 3, packUnit: 'METER', purchase: 620, selling: 790, mrp: 880, minStock: 20, opening: 120 },
    ],
  },
  {
    name: 'Havells FR PVC Wire 1.5 sq mm', code: 'HV-WIRE-15', brand: 'Havells',
    category: 'Electrical', group: 'Wires & Cables', hsn: '8544', tax: 0, stockUnit: 'METER',
    variants: [
      { name: '90 M Coil', sku: 'HV-WIRE-15-90', barcode: '8901234550014', packSize: 90, packUnit: 'METER', purchase: 1450, selling: 1790, mrp: 2050, minStock: 180, opening: 900, isDefault: true },
      { name: 'Per Meter', sku: 'HV-WIRE-15-M',  barcode: '8901234550021', packSize: 1,  packUnit: 'METER', purchase: 17,   selling: 24,   mrp: 28,   minStock: 100, opening: 0 },
    ],
  },
  {
    name: 'Bosch GSB 550 Impact Drill Kit', code: 'BS-GSB550', brand: 'Bosch',
    category: 'Tools', group: 'Power Tools', hsn: '8467', tax: 0, stockUnit: 'PCS',
    variants: [
      { name: 'Single Kit', sku: 'BS-GSB550-1', barcode: '8901234560013', packSize: 1, packUnit: 'PCS', purchase: 3250, selling: 4100, mrp: 4650, minStock: 3, opening: 9, isDefault: true },
    ],
  },
  {
    name: 'MS Wire Nail 2 inch', code: 'GN-NAIL-2', brand: 'Generic',
    category: 'Hardware', hsn: '7317', tax: 0, stockUnit: 'KG',
    variants: [
      { name: 'Loose (KG)', sku: 'GN-NAIL-2-KG',  barcode: '8901234570012', packSize: 1,  packUnit: 'KG', purchase: 72,  selling: 95,   mrp: 110,  minStock: 20, opening: 150, isDefault: true },
      { name: '25 KG Bag',  sku: 'GN-NAIL-2-B25', barcode: '8901234570029', packSize: 25, packUnit: 'KG', purchase: 1720, selling: 2250, mrp: 2500, minStock: 50, opening: 250 },
    ],
  },
  {
    name: 'Brass Tap Elbow 15mm', code: 'GN-ELBOW-15', brand: 'Generic',
    category: 'Fittings', group: 'Sanitary', hsn: '7412', tax: 0, stockUnit: 'PCS',
    variants: [
      { name: 'Single', sku: 'GN-ELBOW-15-1',  barcode: '8901234580011', packSize: 1,  packUnit: 'PCS', purchase: 88,  selling: 120,  mrp: 140,  minStock: 20, opening: 140, isDefault: true },
      { name: 'Box of 50', sku: 'GN-ELBOW-15-B', barcode: '8901234580028', packSize: 50, packUnit: 'PCS', purchase: 4100, selling: 5400, mrp: 6200, minStock: 2, opening: 100 },
    ],
  },
];

const CUSTOMERS: Array<[name: string, mobile: string, address: string, gstin: string | null, creditLimit: number]> = [
  ['Walk-in Customer', '', 'Ishuwapur, Saran', null, 0],
  ['Ramesh Kumar Constructions', '9835012345', 'Chhapra Road, Saran, Bihar', '10ABCDE1234F1Z5', 200000],
  ['Sunil Painters', '9199887766', 'Main Road, Ishuwapur', null, 50000],
  ['Gupta Hardware Retail', '8877665544', 'Marhaura, Saran', '10AAACG1234H1ZP', 150000],
  ['Anita Devi', '7766554433', 'Ward 6, Ishuwapur', null, 0],
];

const SUPPLIERS: Array<[name: string, mobile: string, address: string, gstin: string]> = [
  ['Asian Paints Depot Patna', '9431011111', 'Bailey Road, Patna', '10AAACA1234A1Z1'],
  ['Birla Opus Distributor', '9431022222', 'Exhibition Road, Patna', '10AAACB5678B1Z2'],
  ['Shree Electricals Wholesale', '9431033333', 'Chhapra, Saran', '10AAACS9012C1Z3'],
];

async function seedStatic(client: PoolClient): Promise<void> {
  for (const [code, name] of ROLES) {
    await client.query(
      `INSERT INTO roles (code, name) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING`,
      [code, name],
    );
  }
  for (const [code, name, dimension, factor, isBase, dp] of UNITS) {
    await client.query(
      `INSERT INTO units (code, name, dimension, factor_to_base, is_base, decimals)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (code) DO UPDATE SET factor_to_base = EXCLUDED.factor_to_base`,
      [code, name, dimension, factor, isBase, dp],
    );
  }

  await client.query(
    `INSERT INTO invoice_sequences (doc_type, prefix, next_number, padding)
     VALUES ('SALES_INVOICE','INV-',1,5),
            ('PURCHASE_INVOICE','PUR-',1,5),
            ('SALES_RETURN','CRN-',1,5),
            ('PAYMENT','PAY-',1,5)
     ON CONFLICT (doc_type) DO NOTHING`,
  );

  await client.query(
    `INSERT INTO settings (key, value) VALUES ('business', $1::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [
      JSON.stringify({
        name: 'SANTU HARDWARE',
        tagline: 'Hardware · Paint · Plumbing',
        trades: 'HARDWARE | ELECTRICAL | PLUMBING | PAINTS',
        addressLine1: 'Main Road Ishuwapur',
        addressLine2: 'Saran, Bihar 841411',
        phonePrimary: '9097441600',
        phoneSecondary: '7739802334',
        // Printed as shop identity only — no tax is calculated on bills.
        gstin: '10BULPP3722N1ZG',
        state: 'Bihar',
        logoUrl: '/santu-logo-official.png', thermalLogoUrl: '/santu-logo-thermal.png',
        showLogoOnA4: true,
        showLogoOnThermal: true,
        a4LogoHeight: 80,
        thermalLogoHeight: 100,
        currency: 'INR',
        upiId: '7739802334-2@ybl',
        upiPayeeName: 'SANTU HARDWARE',
        exchangeNote: 'Bill is required for exchange. E&OE.',
        terms: '',
        thankYouNote: 'Thank You!',
        invoiceFooter: 'Goods once sold will not be taken back without original invoice.',
        defaultPrintFormat: 'A4',
      }),
    ],
  );
}

async function seedDemo(client: PoolClient): Promise<void> {
  const already = await client.query('SELECT 1 FROM items LIMIT 1');
  if (already.rowCount) {
    console.log('  demo data already present — skipping items/customers/suppliers');
    return;
  }

  const wh = await client.query<{ id: string }>(
    `INSERT INTO warehouses (name, code, address, is_default)
     VALUES ('Main Shop','MAIN','Main Road, Ishuwapur, Saran', true)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  const warehouseId = wh.rows[0]!.id;

  const ids = async (table: string, names: string[]): Promise<Map<string, string>> => {
    const map = new Map<string, string>();
    for (const name of names) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO ${table} (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [name],
      );
      map.set(name, rows[0]!.id);
    }
    return map;
  };

  const categories = await ids('categories', CATEGORIES);
  const brands = await ids('brands', BRANDS);
  const groups = await ids('item_groups', GROUPS);

  const admin = await client.query<{ id: string }>('SELECT id FROM users ORDER BY created_at LIMIT 1');
  const adminId = admin.rows[0]?.id ?? null;

  for (const item of ITEMS) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO items (name, item_code, item_group_id, brand_id, category_id,
                          hsn_code, tax_rate, stock_unit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        item.name, item.code, item.group ? groups.get(item.group) : null,
        brands.get(item.brand), categories.get(item.category), item.hsn, item.tax, item.stockUnit,
      ],
    );
    const itemId = rows[0]!.id;

    for (const v of item.variants) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO item_variants (item_id, name, sku, barcode, pack_size, pack_unit,
                                    purchase_price, selling_price, mrp, min_stock, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [itemId, v.name, v.sku, v.barcode, v.packSize, v.packUnit,
         v.purchase, v.selling, v.mrp, v.minStock, v.isDefault ?? false],
      );
      const variantId = res.rows[0]!.id;

      // Opening stock enters through the ledger like every other movement.
      if (v.opening > 0) {
        await client.query(
          `INSERT INTO stock (variant_id, warehouse_id, quantity) VALUES ($1,$2,$3)`,
          [variantId, warehouseId, v.opening],
        );
        await client.query(
          `INSERT INTO stock_transactions
             (variant_id, warehouse_id, txn_type, quantity, entered_qty, entered_unit,
              balance_after, rate, reference_type, notes, created_by)
           VALUES ($1,$2,'OPENING',$3,$3,$4,$3,$5,'SEED','Opening stock',$6)`,
          [variantId, warehouseId, v.opening, item.stockUnit, v.purchase, adminId],
        );
      } else {
        await client.query(
          `INSERT INTO stock (variant_id, warehouse_id, quantity) VALUES ($1,$2,0)`,
          [variantId, warehouseId],
        );
      }
    }
  }

  for (const [name, mobile, address, gstin, creditLimit] of CUSTOMERS) {
    await client.query(
      `INSERT INTO customers (name, mobile, address, gstin, credit_limit)
       VALUES ($1,$2,$3,$4,$5)`,
      [name, mobile || null, address, gstin, creditLimit],
    );
  }
  for (const [name, mobile, address, gstin] of SUPPLIERS) {
    await client.query(
      `INSERT INTO suppliers (name, mobile, address, gstin) VALUES ($1,$2,$3,$4)`,
      [name, mobile, address, gstin],
    );
  }
}

async function seedAdmin(client: PoolClient): Promise<void> {
  const existing = await client.query('SELECT 1 FROM users LIMIT 1');
  if (existing.rowCount) {
    console.log('  users already exist — admin not recreated');
    return;
  }
  const hash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 12);
  await client.query(
    `INSERT INTO users (name, email, password_hash, role_code)
     VALUES ('Santu Hardware Admin', $1, $2, 'ADMIN')`,
    [env.SEED_ADMIN_EMAIL.toLowerCase(), hash],
  );
  console.log(`  admin created: ${env.SEED_ADMIN_EMAIL}`);
}

export async function seed(): Promise<void> {
  await runMigrations();
  await withTransaction(async (client) => {
    console.log('Seeding Santu Hardware…');
    await seedStatic(client);
    await seedAdmin(client);
    await seedDemo(client);
  });
  console.log('Seed complete.');
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  seed()
    .catch((err: Error) => {
      console.error('Seed failed:', err.message);
      process.exitCode = 1;
    })
    .finally(closePool);
}
