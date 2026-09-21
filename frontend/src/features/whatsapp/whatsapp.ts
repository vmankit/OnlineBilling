/**
 * WhatsApp sharing.
 *
 * Everything here builds a `wa.me` link — WhatsApp's own documented format.
 * That opens WhatsApp (app on iPad/phone, web on desktop) with the recipient
 * and message already filled in; the shopkeeper presses send. No account
 * linking, no session to keep alive, nothing that can get the shop's number
 * banned.
 *
 * Automated sending without a human pressing send is a different thing
 * entirely: it needs the official WhatsApp Business Cloud API, a verified
 * Meta business, a number dedicated to the API, and pre-approved message
 * templates. See `docs/whatsapp.md`.
 */

/**
 * Normalises an Indian mobile number into the international form wa.me needs
 * (country code, no +, no spaces).
 *
 * The subtle case this exists for: a perfectly normal 10-digit mobile can
 * itself start with "91" — 9123456780 is a real number, and one of the shop's
 * customers has exactly that. Testing `startsWith('91')` to decide whether the
 * country code is already present therefore drops the country code from every
 * such number and produces a dead link. Length decides it, not the prefix.
 *
 * Returns null when the number cannot be understood, so the caller can open
 * WhatsApp without a recipient rather than sending someone to a dead chat.
 */
export function normalizeIndianMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  // International dialling prefix, e.g. 00 91 98350 12345
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Domestic trunk prefix, e.g. 0 98350 12345
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 13 && digits.startsWith('091')) digits = digits.slice(1);

  // Already international: 91 + a valid 10-digit mobile.
  if (digits.length === 12 && digits.startsWith('91') && isMobileStart(digits[2])) {
    return digits;
  }

  // Plain 10-digit mobile — including ones that begin with 91.
  if (digits.length === 10 && isMobileStart(digits[0])) {
    return `91${digits}`;
  }

  // Some other country's number, already carrying its own code.
  if (digits.length > 10 && digits.length <= 15 && !digits.startsWith('91')) {
    return digits;
  }

  return null;
}

/** Indian mobile numbers begin with 6, 7, 8 or 9. */
function isMobileStart(digit: string | undefined): boolean {
  return digit !== undefined && digit >= '6' && digit <= '9';
}

/**
 * Builds the share link. With no usable number the link still opens WhatsApp
 * with the message ready, and the user picks the chat — which is what you
 * want for a walk-in customer whose number you never took.
 */
export function buildWaLink(mobile: string | null | undefined, message: string): string {
  const number = normalizeIndianMobile(mobile);
  const text = encodeURIComponent(message);
  return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
}

/** Opens the link in a new tab. Kept in one place so every caller behaves alike. */
export function openWhatsApp(mobile: string | null | undefined, message: string): void {
  window.open(buildWaLink(mobile, message), '_blank', 'noopener,noreferrer');
}

// ----------------------------------------------------------------- templates

export interface ShopIdentity {
  name: string;
  phone?: string | null;
  upiId?: string | null;
}

const money = (value: number): string =>
  `Rs ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface BillMessageInput {
  customerName: string;
  documentLabel: string;
  documentNumber: string;
  date: string;
  grandTotal: number;
  dueAmount?: number | null;
  validUntil?: string | null;
  lines: Array<{ name: string; quantity: number; unit: string; amount: number }>;
}

export function billMessage(shop: ShopIdentity, input: BillMessageInput): string {
  const parts = [
    `*${shop.name}*`,
    `${input.documentLabel} ${input.documentNumber}`,
    `Date: ${input.date}`,
    `Customer: ${input.customerName}`,
    '',
    ...input.lines.map(
      (l) => `${l.name} — ${trimNumber(l.quantity)} ${l.unit} = ${money(l.amount)}`,
    ),
    '',
    `Total: ${money(input.grandTotal)}`,
  ];

  if (input.dueAmount && input.dueAmount > 0) {
    parts.push(`Baki: ${money(input.dueAmount)}`);
  } else if (input.dueAmount !== null && input.dueAmount !== undefined) {
    parts.push('Poora bhugtan ho gaya. Dhanyawad!');
  }

  if (input.validUntil) parts.push(`Yeh rate ${input.validUntil} tak maanya hai.`);
  if (shop.upiId) parts.push('', `UPI: ${shop.upiId}`);
  if (shop.phone) parts.push(`Sampark: ${shop.phone}`);

  return parts.join('\n');
}

export function reminderMessage(
  shop: ShopIdentity,
  customerName: string,
  outstanding: number,
): string {
  const parts = [
    `Namaste ${customerName},`,
    '',
    `*${shop.name}* se aapka kul baki hisab ${money(outstanding)} hai.`,
    'Kripya samay par bhugtan karein.',
  ];
  if (shop.upiId) parts.push('', `UPI se bhej sakte hain: ${shop.upiId}`);
  if (shop.phone) parts.push(`Sampark: ${shop.phone}`);
  parts.push('', 'Dhanyawad!');
  return parts.join('\n');
}

export function statementMessage(
  shop: ShopIdentity,
  customerName: string,
  totalPurchases: number,
  outstanding: number,
): string {
  const parts = [
    `*${shop.name}* — Khata Statement`,
    '',
    `Customer: ${customerName}`,
    `Kul kharid: ${money(totalPurchases)}`,
    `Baki hisab: ${money(outstanding)}`,
  ];
  if (shop.phone) parts.push('', `Sampark: ${shop.phone}`);
  return parts.join('\n');
}

export function thankYouMessage(shop: ShopIdentity, customerName: string): string {
  return [
    `Namaste ${customerName},`,
    '',
    `*${shop.name}* par kharidari ke liye dhanyawad.`,
    'Dobara aaiyega!',
    shop.phone ? `\nSampark: ${shop.phone}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 3.0480 -> "3.048", 12.0000 -> "12" */
function trimNumber(value: number): string {
  const fixed = Number(value || 0).toFixed(4);
  return fixed.replace(/\.?0+$/, '') || '0';
}
