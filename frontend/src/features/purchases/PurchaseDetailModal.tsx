import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { usePaySupplier, usePurchase } from '@/services/operations';
import { ApiError } from '@/lib/api';

const money = (value: number): string =>
  `₹ ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * One purchase bill, and a way to pay what is still owed on it.
 *
 * Purchase rows used to go nowhere when tapped, and an unpaid bill had no
 * way to be settled at all — the supplier's balance could only ever grow.
 */
export function PurchaseDetailModal({
  purchaseId,
  onClose,
}: {
  purchaseId: string;
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();
  const { data: bill, isLoading } = usePurchase(purchaseId);
  const pay = usePaySupplier();

  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'CARD' | 'BANK'>('CASH');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const due = Number(bill?.due_amount ?? 0);

  const submit = (): void => {
    setError(null);
    const value = Number(amount);
    if (!(value > 0)) {
      setError('Rakam likhiye.');
      return;
    }
    if (value > due + 0.01) {
      setError(`Is bill par sirf ${money(due)} baki hai.`);
      return;
    }
    pay.mutate(
      {
        supplier_id: bill!.supplier_id,
        purchase_id: bill!.id,
        amount: value,
        method,
        reference: reference.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success('Payment darj ho gaya', `${money(value)} — ${bill!.supplier_name}`);
          setPaying(false);
          setAmount('');
          setReference('');
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : 'Payment save nahi hua.'),
      },
    );
  };

  return (
    <Modal open onClose={onClose} title={bill ? `Purchase ${bill.purchase_number}` : 'Purchase'} size="lg">
      {isLoading || !bill ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="text-xs text-slate-500">Mahajan</div>
              <div className="font-semibold">{bill.supplier_name}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Unka bill no.</div>
              <div className="font-semibold">{bill.supplier_invoice_number || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Date</div>
              <div className="font-semibold">
                {new Date(bill.invoice_date).toLocaleDateString('en-IN')}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Status</div>
              <div className="font-semibold">{bill.status}</div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {bill.items.map((line) => (
                  <tr key={line.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{line.line_no}</td>
                    <td className="px-3 py-2">{line.item_name}</td>
                    <td className="px-3 py-2 text-right">
                      {Number(line.quantity)} {line.purchase_unit}
                    </td>
                    <td className="px-3 py-2 text-right">{money(Number(line.rate))}</td>
                    <td className="px-3 py-2 text-right">{money(Number(line.line_total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ml-auto w-full max-w-xs space-y-1">
            <div className="flex justify-between">
              <span>Total</span>
              <b>{money(Number(bill.grand_total))}</b>
            </div>
            <div className="flex justify-between text-emerald-700">
              <span>Diya</span>
              <span>{money(Number(bill.paid_amount))}</span>
            </div>
            <div className="flex justify-between text-rose-600">
              <span>Baki</span>
              <b>{money(due)}</b>
            </div>
          </div>

          {due > 0 && bill.status !== 'CANCELLED' && (
            <div className="rounded-lg border border-slate-200 p-3">
              {!paying ? (
                <Button
                  onClick={() => {
                    setPaying(true);
                    setAmount(String(due));
                  }}
                >
                  Payment Out — mahajan ko dein
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="pay-amount">Rakam</Label>
                      <Input
                        id="pay-amount"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="pay-method">Kaise diya</Label>
                      <Select
                        id="pay-method"
                        value={method}
                        onChange={(e) => setMethod(e.target.value as typeof method)}
                      >
                        <option value="CASH">Cash</option>
                        <option value="UPI">UPI</option>
                        <option value="BANK">Bank</option>
                        <option value="CARD">Card</option>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="pay-ref">Reference (optional)</Label>
                      <Input
                        id="pay-ref"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        placeholder="UTR / cheque no."
                      />
                    </div>
                  </div>
                  {error && <p className="text-rose-600">{error}</p>}
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setPaying(false)} disabled={pay.isPending}>
                      Cancel
                    </Button>
                    <Button onClick={submit} disabled={pay.isPending}>
                      {pay.isPending ? 'Saving…' : 'Payment save karein'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
