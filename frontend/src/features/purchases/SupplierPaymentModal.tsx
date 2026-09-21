import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { usePaySupplier } from '@/services/operations';
import { ApiError } from '@/lib/api';

const money = (value: number): string =>
  `₹ ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Payment Out to a mahajan, from the Parties screen. The amount settles their
 * oldest unpaid purchase bills first, the way the shop clears a khata.
 */
export function SupplierPaymentModal({
  supplier,
  onClose,
}: {
  supplier: { id: string; name: string; owed: number };
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();
  const pay = usePaySupplier();
  const [amount, setAmount] = useState(String(supplier.owed));
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'CARD' | 'BANK'>('CASH');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    setError(null);
    const value = Number(amount);
    if (!(value > 0)) {
      setError('Rakam likhiye.');
      return;
    }
    if (value > supplier.owed + 0.01) {
      setError(`${supplier.name} ko sirf ${money(supplier.owed)} dena hai.`);
      return;
    }
    pay.mutate(
      { supplier_id: supplier.id, amount: value, method, reference: reference.trim() || null },
      {
        onSuccess: () => {
          toast.success('Payment Out darj ho gaya', `${money(value)} — ${supplier.name}`);
          onClose();
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : 'Payment save nahi hua.'),
      },
    );
  };

  return (
    <Modal open onClose={onClose} title={`Payment Out — ${supplier.name}`}>
      <div className="space-y-4 text-sm">
        <p>
          Kul dena baki: <b>{money(supplier.owed)}</b>. Rakam sabse purane bill se katti jayegi.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="sp-amount">Rakam</Label>
            <Input id="sp-amount" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sp-method">Kaise diya</Label>
            <Select id="sp-method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="BANK">Bank</option>
              <option value="CARD">Card</option>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sp-ref">Reference (optional)</Label>
          <Input id="sp-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
        </div>
        {error && <p className="text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pay.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pay.isPending}>
            {pay.isPending ? 'Saving…' : 'Payment save karein'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
