import { useMemo, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { useCreateReturn, useReturnableLines } from '@/services/operations';
import { ApiError } from '@/lib/api';
import { formatMoney, formatQty } from '@/lib/utils';

/**
 * Return against an existing invoice. Quantities are capped at what is still
 * returnable (sold minus already returned) both here and on the server.
 */
export function SalesReturnModal({
  invoiceId,
  onClose,
}: {
  invoiceId: string;
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();
  const { data, isLoading } = useReturnableLines(invoiceId);
  const create = useCreateReturn();

  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [refundMode, setRefundMode] = useState<'CREDIT_NOTE' | 'CASH' | 'UPI' | 'BANK'>('CREDIT_NOTE');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const total = useMemo(() => {
    if (!data) return 0;
    return data.items.reduce((sum, line) => {
      const q = Number(quantities[line.invoice_item_id] ?? 0);
      return sum + q * Number(line.rate);
    }, 0);
  }, [data, quantities]);

  const submit = async (): Promise<void> => {
    setError('');
    if (!data) return;

    const items = data.items
      .map((line) => ({
        invoice_item_id: line.invoice_item_id,
        quantity: Number(quantities[line.invoice_item_id] ?? 0),
      }))
      .filter((l) => l.quantity > 0);

    if (items.length === 0) return setError('Enter a return quantity for at least one item.');

    const over = data.items.find((line) => {
      const q = Number(quantities[line.invoice_item_id] ?? 0);
      return q > Number(line.returnable) + 0.0001;
    });
    if (over) {
      return setError(
        `${over.item_name}: only ${formatQty(over.returnable)} ${over.sold_unit} can still be returned.`,
      );
    }

    try {
      await create.mutateAsync({
        invoice_id: invoiceId,
        refund_mode: refundMode,
        notes: notes.trim() || null,
        items,
      });
      toast.success('Return recorded', 'Stock has been put back.');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to record this return.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Return items"
      description={data ? `Against invoice ${data.invoice.invoice_number}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={create.isPending} disabled={total <= 0}>
            <Undo2 className="h-5 w-5" />
            Return {formatMoney(total)}
          </Button>
        </>
      }
    >
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="space-y-2">
            {data.items.map((line) => {
              const returnable = Number(line.returnable);
              const exhausted = returnable <= 0;
              return (
                <div
                  key={line.invoice_item_id}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 p-3"
                >
                  <div className="min-w-[160px] flex-1">
                    <p className="text-sm font-medium text-slate-900">{line.item_name}</p>
                    <p className="text-xs text-slate-500">
                      Sold {formatQty(line.quantity)} {line.sold_unit} at {formatMoney(line.rate)}
                      {Number(line.returned_qty) > 0 &&
                        ` · ${formatQty(line.returned_qty)} already returned`}
                    </p>
                  </div>

                  <div className="shrink-0 text-right text-xs text-slate-500">
                    returnable
                    <p className="text-sm font-medium text-slate-700">
                      {formatQty(returnable)} {line.sold_unit}
                    </p>
                  </div>

                  <div className="w-28 shrink-0">
                    <Input
                      value={quantities[line.invoice_item_id] ?? ''}
                      onChange={(e) =>
                        setQuantities((prev) => ({ ...prev, [line.invoice_item_id]: e.target.value }))
                      }
                      placeholder="0"
                      inputMode="decimal"
                      disabled={exhausted}
                      className="h-11 text-right"
                    />
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={exhausted}
                    onClick={() =>
                      setQuantities((prev) => ({
                        ...prev,
                        [line.invoice_item_id]: String(returnable),
                      }))
                    }
                  >
                    All
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ret-mode">Refund as</Label>
              <Select
                id="ret-mode"
                value={refundMode}
                onChange={(e) => setRefundMode(e.target.value as typeof refundMode)}
              >
                <option value="CREDIT_NOTE">Credit note (adjust balance)</option>
                <option value="CASH">Cash refund</option>
                <option value="UPI">UPI refund</option>
                <option value="BANK">Bank transfer</option>
              </Select>
              <p className="mt-1.5 text-xs text-slate-500">
                Any balance still due on this invoice is cleared first; the rest is refunded.
              </p>
            </div>
            <div>
              <Label htmlFor="ret-notes">Notes</Label>
              <Textarea id="ret-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
        </>
      )}

      <FieldError>{error}</FieldError>
    </Modal>
  );
}
