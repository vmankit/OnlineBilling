import { query } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { getBridgeStatus, sendTextMessage } from './whatsapp.service.js';

/**
 * Sends a bill to the customer on WhatsApp the moment it is saved, when the
 * shop has switched that on under WhatsApp → Transaction Message.
 *
 * The setting existed on screen for a while with nothing behind it: the box
 * could be ticked and saved, and no bill was ever sent. This is what the tick
 * now does.
 *
 * It never gets in the way of billing. It runs after the sale has committed,
 * every failure is logged and swallowed, and nothing waits on it — a bill
 * must go through whether or not the phone is linked.
 */

interface TxnMessageSettings {
  auto_send_on_submit?: boolean;
  auto_send_types?: Record<string, boolean>;
  /** The counter sends the receipt image + PDF itself; the text below is then skipped. */
  send_bill_as_image?: boolean;
  send_copy_to_self?: boolean;
  owner_whatsapp_number?: string;
  include_web_invoice_link?: boolean;
  include_payment_link?: boolean;
  templates?: Record<string, string>;
}

/** Used only when the shop has never saved a template of its own. */
const DEFAULT_SALE_TEMPLATE = `🧾 *{{ company_name }}*

Namaste {{ customer_name }},

*Bill No:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Total:* ₹{{ grand_total }}
*Paid:* ₹{{ paid_amount }}
*Baki:* ₹{{ outstanding_amount }}

{{ invoice_link }}

Dhanyawad 🙏`;

const money = (value: unknown): string =>
  Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Replaces `{{ name }}` and `{{name}}`. A line whose placeholders all came out
 * empty is dropped — with no UPI id on file, "📲 Pay via UPI:" would otherwise
 * go out with nothing after it. Lines without placeholders (headings such as
 * "💰 Payment Breakdown:") are always kept.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  const placeholder = /\{\{\s*([a-z_]+)\s*\}\}/g;
  return template
    .split('\n')
    .flatMap((line) => {
      const keys = [...line.matchAll(placeholder)].map((m) => m[1]!);
      if (keys.length > 0 && keys.every((k) => !vars[k])) return [];
      return [line.replace(placeholder, (_, key: string) => vars[key] ?? '')];
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readSetting<T>(key: string): Promise<T | null> {
  const { rows } = await query<{ value: T }>('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function autoSendSale(saleId: string): Promise<void> {
  const settings = await readSetting<TxnMessageSettings>('transaction_message_settings');
  if (!settings?.auto_send_on_submit) return;
  if (settings.auto_send_types && settings.auto_send_types['Sales Transaction'] === false) return;

  const { rows } = await query<{
    invoice_number: string; customer_name: string; customer_mobile: string | null;
    customer_id: string | null; invoice_date: string; grand_total: number;
    paid_amount: number; due_amount: number; status: string;
  }>(
    `SELECT invoice_number, customer_name, customer_mobile, customer_id, invoice_date,
            grand_total, paid_amount, due_amount, status
       FROM sales_invoices WHERE id = $1`,
    [saleId],
  );
  const sale = rows[0];
  // A held bill is not a bill yet; nothing to tell the customer.
  if (!sale || sale.status !== 'COMPLETED') return;

  const status = await getBridgeStatus();
  if (status.state !== 'CONNECTED') return;

  const business = (await readSetting<Record<string, string>>('business')) ?? {};
  let balance = Number(sale.due_amount);
  if (sale.customer_id) {
    const c = await query<{ outstanding_balance: number }>(
      'SELECT outstanding_balance FROM customers WHERE id = $1',
      [sale.customer_id],
    );
    balance = Number(c.rows[0]?.outstanding_balance ?? balance);
  }

  const origin = env.corsOrigins[0] ?? '';
  const vars: Record<string, string> = {
    company_name: business.name ?? 'Santu Hardware',
    customer_name: sale.customer_name,
    party_name: sale.customer_name,
    invoice_no: sale.invoice_number,
    transaction_type: 'Sales Transaction',
    posting_date: new Date(sale.invoice_date).toLocaleDateString('en-IN'),
    grand_total: money(sale.grand_total),
    paid_amount: money(sale.paid_amount),
    outstanding_amount: money(sale.due_amount),
    current_balance: money(balance),
    invoice_link:
      settings.include_web_invoice_link === false || !origin ? '' : `${origin}/bill/${saleId}`,
    payment_link: settings.include_payment_link === false ? '' : (business.upiId ?? ''),
    company_phone: business.phonePrimary ?? '',
    company_address: [business.addressLine1, business.addressLine2].filter(Boolean).join(', '),
  };

  const template = settings.templates?.['Sales Transaction'] || DEFAULT_SALE_TEMPLATE;
  const message = renderTemplate(template, vars);

  // In "receipt image" mode the till renders and sends the bill (only it has
  // a browser to draw it in). Sending this text too would put the same bill
  // in the customer's chat twice.
  if (sale.customer_mobile && !settings.send_bill_as_image) {
    try {
      await sendTextMessage(sale.customer_mobile, message);
    } catch (err) {
      console.warn(`[WhatsApp auto-send] ${sale.invoice_number}:`, (err as Error).message);
    }
  }

  if (settings.send_copy_to_self && settings.owner_whatsapp_number) {
    try {
      await sendTextMessage(settings.owner_whatsapp_number, `(Copy) ${message}`);
    } catch (err) {
      console.warn(`[WhatsApp auto-send copy] ${sale.invoice_number}:`, (err as Error).message);
    }
  }
}
