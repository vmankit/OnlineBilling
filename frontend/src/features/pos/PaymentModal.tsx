import { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, Landmark, Smartphone, UserCheck } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label } from '@/components/ui/Field';
import { cn, formatMoney } from '@/lib/utils';
import { checkPrices, type PriceDifference } from '@/services/sales';
import { PriceChangeModal } from './PriceChangeModal';
import type { CartLine } from './usePosCart';

type Method = 'CASH' | 'UPI' | 'CARD' | 'BANK' | 'CREDIT';

const METHODS: Array<{ code: Method; label: string; icon: typeof Banknote }> = [
  { code: 'CASH', label: 'Cash', icon: Banknote },
  { code: 'UPI', label: 'UPI', icon: Smartphone },
  { code: 'CARD', label: 'Card', icon: CreditCard },
  { code: 'BANK', label: 'Bank', icon: Landmark },
];

export interface Tender {
  method: Method;
  amount: number;
  reference?: string | null;
}

export function PaymentModal({
  total,
  customerId,
  customerName,
  lines,
  submitting,
  skipPriceCheck = false,
  onCancel,
  onConfirm,
  onRateChange,
}: {
  total: number;
  customerId: string | null;
  customerName: string;
  lines: CartLine[];
  submitting: boolean;
  /** True when the rates were already confirmed — e.g. converting a quotation. */
  skipPriceCheck?: boolean;
  onCancel: () => void;
  onConfirm: (tenders: Tender[]) => void;
  onRateChange: (variantId: string, rate: number) => void;
}): JSX.Element {
  const [amounts, setAmounts] = useState<Record<Method, string>>({
    CASH: '',
    UPI: '',
    CARD: '',
    BANK: '',
    CREDIT: '',
  });
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [priceDiffs, setPriceDiffs] = useState<PriceDifference[] | null>(null);
  const [priceChecked, setPriceChecked] = useState(false);

  // Before taking money, confirm the rates on the bill still match the master —
  // unless that decision was already made, which is the case when a quotation
  // was converted. Asking twice trains the operator to dismiss the dialog.
  useEffect(() => {
    if (skipPriceCheck) {
      setPriceChecked(true);
      return;
    }

    let cancelled = false;
    checkPrices(lines.map((l) => ({ variant_id: l.variantId, rate: l.rate })))
      .then((diffs) => {
        if (cancelled) return;
        setPriceDiffs(diffs.length ? diffs : null);
        setPriceChecked(true);
      })
      .catch(() => {
        // A failed check must not block billing; the saved rates stand.
        if (!cancelled) setPriceChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lines, skipPriceCheck]);

  const paid = useMemo(
    () => Object.values(amounts).reduce((sum, v) => sum + (Number(v) || 0), 0),
    [amounts],
  );
  const due = Math.max(0, Number((total - paid).toFixed(2)));
  const change = Math.max(0, Number((paid - total).toFixed(2)));

  const setAmount = (method: Method, value: string): void => {
    setAmounts((prev) => ({ ...prev, [method]: value }));
  };

  const fill = (method: Method): void => {
    const remaining = Math.max(0, total - (paid - (Number(amounts[method]) || 0)));
    setAmount(method, remaining.toFixed(2));
  };

  const confirm = (): void => {
    setError('');
    if (paid > total + 0.01 && paid - total > 0) {
      // Overpayment is fine for cash (change given), but never recorded as
      // more money received than the bill is worth.
      setError(`Received ${formatMoney(paid)} against a ${formatMoney(total)} bill. Reduce the amount.`);
      return;
    }
    if (due > 0 && !customerId) {
      setError('A balance due must be billed to a saved customer. Pick a customer first.');
      return;
    }

    const tenders: Tender[] = METHODS.map(({ code }) => ({
      method: code,
      amount: Number(amounts[code]) || 0,
      reference: code === 'UPI' || code === 'BANK' || code === 'CARD' ? reference || null : null,
    })).filter((t) => t.amount > 0);

    onConfirm(tenders);
  };

  if (priceDiffs) {
    return (
      <PriceChangeModal
        differences={priceDiffs}
        onKeep={() => setPriceDiffs(null)}
        onUpdate={() => {
          for (const d of priceDiffs) onRateChange(d.variant_id, d.new_rate);
          setPriceDiffs(null);
        }}
      />
    );
  }

  return (
    <Modal
      open
      onClose={onCancel}
      size="md"
      title="Payment"
      description={`Billing ${customerName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Back
          </Button>
          <Button
            size="lg"
            variant={due > 0 ? 'primary' : 'success'}
            onClick={confirm}
            loading={submitting}
            disabled={!priceChecked}
          >
            {due > 0 ? `Save with ${formatMoney(due)} due` : 'Complete & generate invoice'}
          </Button>
        </>
      }
    >
      <div className="mb-5 rounded-2xl bg-slate-900 p-5 text-white">
        <p className="text-sm text-slate-300">Bill total</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">{formatMoney(total)}</p>
        <div className="mt-4 flex gap-6 border-t border-white/10 pt-4 text-sm">
          <div>
            <p className="text-slate-400">Received</p>
            <p className="mt-0.5 text-lg font-semibold">{formatMoney(paid)}</p>
          </div>
          <div>
            <p className="text-slate-400">{change > 0 ? 'Change' : 'Balance due'}</p>
            <p
              className={cn(
                'mt-0.5 text-lg font-semibold',
                change > 0 ? 'text-amber-300' : due > 0 ? 'text-rose-300' : 'text-emerald-300',
              )}
            >
              {formatMoney(change > 0 ? change : due)}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {METHODS.map(({ code, label, icon: Icon }) => (
          <div key={code} className="flex items-center gap-3">
            <div className="flex w-28 shrink-0 items-center gap-2 text-[15px] font-medium text-slate-700">
              <Icon className="h-5 w-5 text-slate-400" />
              {label}
            </div>
            <Input
              value={amounts[code]}
              onChange={(e) => setAmount(code, e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              className="h-12 flex-1 text-right text-base"
            />
            <Button variant="secondary" size="sm" onClick={() => fill(code)} className="shrink-0">
              Full
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <Label htmlFor="pay-ref">Reference (UPI / card / bank)</Label>
        <Input
          id="pay-ref"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Transaction id, last 4 digits…"
        />
      </div>

      {due > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
          <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            {formatMoney(due)} will be added to {customerName}&apos;s outstanding balance.
          </p>
        </div>
      )}

      <FieldError>{error}</FieldError>
    </Modal>
  );
}
