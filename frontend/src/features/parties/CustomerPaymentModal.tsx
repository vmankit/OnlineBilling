import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useReceivePayment } from '@/services/sales';
import { ApiError } from '@/lib/api';

const money = (value: number): string =>
  `₹ ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Payment In from a customer, taken on the Parties screen. The amount settles
 * their oldest unpaid bills first, the way a khata is cleared.
 *
 * "Record Payment" used to be a link to /sales?tab=payment-in, which nothing
 * read — it opened the plain invoice list and recorded nothing.
 */
export function CustomerPaymentModal({
  customer,
  onClose,
}: {
  customer: { id: string; name: string; owes: number };
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();
  const receive = useReceivePayment();
  const [amount, setAmount] = useState(String(customer.owes));
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
    if (value > customer.owes + 0.01) {
      setError(`${customer.name} ka sirf ${money(customer.owes)} baki hai.`);
      return;
    }
    receive.mutate(
      {
        customer_id: customer.id,
        methods: [{ method, amount: value, reference: reference.trim() || null }],
      },
      {
        onSuccess: () => {
          toast.success('Payment In darj ho gaya', `${money(value)} — ${customer.name}`);
          onClose();
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : 'Payment save nahi hua.'),
      },
    );
  };

  return (
    <Modal open onClose={onClose} title={`Payment In — ${customer.name}`}>
      <div className="space-y-4 text-sm">
        <p>
          Kul baki: <b>{money(customer.owes)}</b>. Rakam sabse purane bill se katti jayegi.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="cp-amount">Rakam</Label>
            <Input id="cp-amount" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-method">Kaise mila</Label>
            <Select id="cp-method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="BANK">Bank</option>
              <option value="CARD">Card</option>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cp-ref">Reference (optional)</Label>
          <Input id="cp-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
        </div>
        {error && <p className="text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={receive.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={receive.isPending}>
            {receive.isPending ? 'Saving…' : 'Payment In darj karein'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
