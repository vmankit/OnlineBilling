import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, downloadFile } from '@/lib/api';
import { useSettings, useUpdateSetting } from '@/services/catalog';
import { fileToLogo } from '@/features/invoices/logoFile';
import { useToast } from '@/components/ui/Toast';
import type { BusinessSettings, Item, Paginated } from '@/types';

/**
 * Utilities.
 *
 * Layout and class names come from the shop's earlier `santu_utilities.js` /
 * `santu_utilities_views.js`, so `styles/santu/santu_utilities.css` styles
 * this screen unchanged.
 *
 * Only the tools that do something are here. The old screen had twenty-two
 * views, most of which this app has nothing behind (Tally export, salesman
 * tracking, loyalty points, voice model, accountant access, close financial
 * year). Earlier this page carried six of them as buttons that popped
 * "Saved" without saving anything, and a mic test that reported a fixed
 * "12ms" without touching the microphone. Those are gone rather than
 * re-skinned: a button that lies about saving is worse than no button.
 */

type View = 'shop_profile' | 'verify_data' | 'export_items' | 'more';

const VIEWS: Array<[View, string]> = [
  ['shop_profile', 'Shop Profile'],
  ['verify_data', 'Verify My Data'],
  ['export_items', 'Export Items'],
  ['more', 'Aur bhi'],
];

const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

export function UtilitiesPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') ?? 'shop_profile';
  const view = (VIEWS.some(([v]) => v === raw) ? raw : 'shop_profile') as View;

  const title = VIEWS.find(([v]) => v === view)?.[1] ?? 'Utilities';

  return (
    <div className="santu-utilities">
      <div className="santu-utilities-header">
        <h1 className="santu-utilities-title">{title}</h1>
        <div className="santu-utilities-actions">
          {VIEWS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`santu-pm-add-btn${view === value ? ' santu-pm-ok' : ''}`}
              onClick={() => setParams({ tab: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="santu-utilities-content">
        {view === 'shop_profile' && <ShopProfile />}
        {view === 'verify_data' && <VerifyData />}
        {view === 'export_items' && <ExportItems />}
        {view === 'more' && <MoreTools />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ shop profile

function ShopProfile(): JSX.Element {
  const toast = useToast();
  const { data: settings, isLoading } = useSettings();
  const saveSetting = useUpdateSetting();
  const [form, setForm] = useState<BusinessSettings | null>(null);

  // Settings resolve after the first paint, so the form is seeded once they
  // land rather than from an empty object.
  useEffect(() => {
    if (settings?.business) setForm(settings.business);
  }, [settings]);

  if (isLoading || !form) return <div className="santu-shop-profile-loading">Loading…</div>;

  const set = <K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]): void =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const field = (
    label: string,
    key: keyof BusinessSettings,
    extra?: { maxLength?: number; uppercase?: boolean },
  ): JSX.Element => (
    <label className="santu-shop-field">
      <span>{label}</span>
      <input
        type="text"
        value={String(form[key] ?? '')}
        maxLength={extra?.maxLength}
        style={extra?.uppercase ? { textTransform: 'uppercase' } : undefined}
        onChange={(e) => set(key, e.target.value as BusinessSettings[typeof key])}
      />
    </label>
  );


  return (
    <div className="santu-shop-profile">
      <div className="santu-shop-card">
        <div className="santu-shop-head">
          <div className="santu-shop-title">Shop Profile</div>
          <button
            type="button"
            className="santu-shop-save"
            disabled={saveSetting.isPending}
            onClick={() =>
              saveSetting.mutate(
                { key: 'business', value: form },
                {
                  onSuccess: () => toast.success('Shop profile saved'),
                  onError: () => toast.error('Could not save the shop profile'),
                },
              )
            }
          >
            {saveSetting.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div className="santu-shop-body">
          <div className="santu-shop-logo-col">
            <div className="santu-shop-logo">
              <img className="santu-shop-logo-img" src={form.shopLogoUrl || '/santu-logo-square.png'} alt="" />
            </div>
            <span className="text-xs font-semibold text-slate-600">Shop logo</span>
            <label className="inline-flex h-8 cursor-pointer items-center rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800">
              Upload
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  try {
                    const next = { ...form, shopLogoUrl: await fileToLogo(file) };
                    setForm(next);
                    saveSetting.mutate(
                      { key: 'business', value: next },
                      {
                        onSuccess: () => toast.success('Shop logo saved'),
                        onError: () => toast.error('Could not save the logo'),
                      },
                    );
                  } catch {
                    toast.error('Could not read this image', 'Pick a PNG or JPG file.');
                  }
                }}
              />
            </label>
          </div>
          <div className="santu-shop-fields">
            {field('Business Name', 'name', { maxLength: 140 })}
            <div className="santu-shop-row">
              {field('Phone', 'phonePrimary', { maxLength: 20 })}
              {field('Second Phone', 'phoneSecondary', { maxLength: 20 })}
            </div>
            <div className="santu-shop-row">
              {/* Printed as shop identity. No tax is charged against it. */}
              {field('GSTIN', 'gstin', { maxLength: 15, uppercase: true })}
              {field('Tagline', 'tagline', { maxLength: 80 })}
            </div>
            {field('Address line 1', 'addressLine1', { maxLength: 140 })}
            <div className="santu-shop-row">
              {field('Address line 2', 'addressLine2', { maxLength: 140 })}
              <label className="santu-shop-field">
                <span>State</span>
                <select value={form.state} onChange={(e) => set('state', e.target.value)}>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="santu-shop-row">
              {field('UPI ID', 'upiId', { maxLength: 80 })}
              {field('UPI Payee Name', 'upiPayeeName', { maxLength: 80 })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- verify data

interface HealthIssue {
  category: string;
  severity: 'Error' | 'Warning';
  record: string;
  description: string;
  fix: string;
}

interface HealthReport {
  checks: number;
  passed: number;
  errors: number;
  warnings: number;
  health: string;
  issues: HealthIssue[];
}

function VerifyData(): JSX.Element {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['health-check'],
    queryFn: () =>
      api.get<{ data: HealthReport }>('/api/masters/health-check').then((r) => r.data),
  });

  if (isLoading || !data) return <div className="santu-shop-profile-loading">Scanning…</div>;

  return (
    <div className="santu-pm-container">
      <div className="santu-pm-card">
        <div className="santu-pm-head verify-head">
          <div className="santu-pm-title">
            <h2>Database Health Check</h2>
            <p>Aapke data me koi gadbadi hai kya — yeh sirf batata hai, badalta nahi.</p>
          </div>
          <div className="verify-health-score">
            <span className="health-label">System Health</span>
            <span
              className={`health-value ${
                data.errors > 0 ? 'bad' : data.warnings > 0 ? 'warn' : 'good'
              }`}
            >
              {data.health}
            </span>
          </div>
        </div>

        <div className="santu-pm-body">
          <div className="santu-verify-grid">
            <div className="verify-stat-card good">
              <div className="stat-icon">✅</div>
              <div className="stat-info">
                <h3>{data.passed}</h3>
                <p>of {data.checks} checks clean</p>
              </div>
            </div>
            <div className="verify-stat-card warn">
              <div className="stat-icon">⚠️</div>
              <div className="stat-info">
                <h3>{data.warnings}</h3>
                <p>Warnings</p>
              </div>
            </div>
            <div className="verify-stat-card bad">
              <div className="stat-icon">❌</div>
              <div className="stat-info">
                <h3>{data.errors}</h3>
                <p>Errors</p>
              </div>
            </div>
          </div>

          <div className="santu-utilities-actions">
            <button
              type="button"
              className="santu-pm-add-btn"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              {isFetching ? 'Scanning…' : 'Dubara scan karein'}
            </button>
          </div>

          {data.issues.length === 0 ? (
            <div className="santu-verify-perfect">
              <div className="verify-perfect-icon">🎉</div>
              <h3>Sab theek hai</h3>
              <p>Koi gadbadi nahi mili.</p>
            </div>
          ) : (
            <div className="santu-verify-issues">
              <table className="santu-verify-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Severity</th>
                    <th>Record</th>
                    <th>Kya hai</th>
                    <th>Kya karein</th>
                  </tr>
                </thead>
                <tbody>
                  {data.issues.map((issue, i) => (
                    <tr key={i} className={`severity-${issue.severity.toLowerCase()}`}>
                      <td>
                        <span className="verify-badge">{issue.category}</span>
                      </td>
                      <td>
                        <span className={`verify-severity-badge severity-${issue.severity.toLowerCase()}`}>
                          {issue.severity === 'Error' ? '❌' : '⚠️'} {issue.severity}
                        </span>
                      </td>
                      <td className="verify-record">{issue.record}</td>
                      <td className="verify-desc">{issue.description}</td>
                      <td className="verify-fix">{issue.fix}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ export items

function ExportItems(): JSX.Element {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [allBusy, setAllBusy] = useState(false);

  const run = async (): Promise<void> => {
    setBusy(true);
    setDone(null);
    try {
      const rows: string[][] = [];
      // Paged so the whole catalogue comes out, not the first screenful.
      for (let page = 1; ; page++) {
        const result = await api.get<Paginated<Item>>('/api/items', {
          page,
          pageSize: 100,
          activeOnly: 'false',
        });
        for (const item of result.data) {
          for (const v of item.variants ?? []) {
            rows.push([
              item.item_code,
              item.name,
              v.name,
              v.sku,
              v.barcode ?? '',
              item.brand_name ?? '',
              item.category_name ?? '',
              item.stock_unit,
              String(v.pack_size),
              String(v.purchase_price),
              String(v.selling_price),
              String(v.mrp),
              String(v.min_stock),
              String(v.stock ?? 0),
            ]);
          }
        }
        if (page >= result.totalPages) break;
      }

      const header = [
        'Item Code', 'Name', 'Pack', 'SKU', 'Barcode', 'Brand', 'Category',
        'Stock Unit', 'Pack Size', 'Purchase Price', 'Selling Price', 'MRP',
        'Min Stock', 'Stock',
      ];
      const escape = (cell: string): string =>
        /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
      const csv = [header, ...rows].map((line) => line.map(escape).join(',')).join('\n');

      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `items-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setDone(rows.length);
    } catch {
      toast.error('Export nahi ho paya');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="santu-utilities-section">
      <h2 className="santu-utilities-subtitle">Export Items</h2>
      <p className="santu-utilities-muted">
        Poora item catalogue ek CSV file me — rate, stock, barcode sab. Excel me khul jayegi.
      </p>
      <div className="santu-utilities-actions">
        <button type="button" className="santu-pm-add-btn" disabled={busy} onClick={() => void run()}>
          {busy ? 'Ban raha hai…' : 'Download CSV'}
        </button>
      </div>
      {done !== null && <p className="santu-utilities-muted">{done} rows export ho gaye.</p>}

      <h2 className="santu-utilities-subtitle" style={{ marginTop: 24 }}>Poora data Excel me</h2>
      <p className="santu-utilities-muted">
        Sale, items, stock ledger, return, estimate, purchase, payment, expense, customers aur baki — sab, alag-alag sheet me ek .xlsx file.
      </p>
      <div className="santu-utilities-actions">
        <button
          type="button"
          className="santu-pm-add-btn"
          disabled={allBusy}
          onClick={async () => {
            setAllBusy(true);
            try {
              await downloadFile('/api/export/excel', 'santu-hardware-data.xlsx');
            } catch {
              toast.error('Excel download nahi ho paya');
            } finally {
              setAllBusy(false);
            }
          }}
        >
          {allBusy ? 'Ban raha hai…' : 'Download all data (Excel)'}
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- more tools

function MoreTools(): JSX.Element {
  return (
    <div className="santu-utilities-section">
      <h2 className="santu-utilities-subtitle">Aur bhi</h2>
      <div className="santu-utilities-method-grid">
        <Link className="santu-utilities-method-card" to="/import-items">
          <div className="method-icon">📥</div>
          <h3>Import Items</h3>
          <p>CSV ya Excel se item list daalein.</p>
        </Link>
        <Link className="santu-utilities-method-card" to="/invoice-templates">
          <div className="method-icon">🖨</div>
          <h3>Invoice &amp; Printer Settings</h3>
          <p>Bill ka design, logo, thermal/A4 aur numbering.</p>
        </Link>
        <Link className="santu-utilities-method-card" to="/stock">
          <div className="method-icon">📦</div>
          <h3>Stock Adjust &amp; Ledger</h3>
          <p>Stock theek karein aur har item ka poora hisab dekhein.</p>
        </Link>
      </div>

      <h2 className="santu-utilities-subtitle" style={{ marginTop: 24 }}>
        Jo abhi nahi hai
      </h2>
      <p className="santu-utilities-muted">
        Purane app me Tally export, Salesman tracking, Loyalty Points, Voice Model, Accountant
        Access, Cost Price Lock aur Close Financial Year bhi the. Is app me unke peeche kuch nahi
        hai, isliye unke button nahi rakhe — dabane par kuch hota nahi. Jo chahiye bataiye, bana
        denge.
      </p>
    </div>
  );
}
