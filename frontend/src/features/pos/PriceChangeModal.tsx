import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatMoney } from '@/lib/utils';
import type { PriceDifference } from '@/services/sales';

/**
 * Shown when a held bill's rates no longer match the item master.
 *
 * Deliberately NOT dismissible: Escape and backdrop clicks do nothing, so the
 * operator cannot skip past the decision and silently bill an old price by
 * accident. One of the two buttons must be chosen.
 */
export function PriceChangeModal({
  differences,
  onKeep,
  onUpdate,
  /** What the saved rates came from — "quotation" or "bill". */
  documentLabel = 'bill',
}: {
  differences: PriceDifference[];
  onKeep: () => void;
  onUpdate: () => void;
  documentLabel?: string;
}): JSX.Element {
  const count = differences.length;
  return (
    <Modal
      open
      dismissible={false}
      onClose={onKeep}
      size="lg"
      title={`Prices have changed since this ${documentLabel} was saved`}
      description="Choose which price to use. Invoices already issued are never affected."
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={onKeep}>
            Keep saved price
          </Button>
          <Button size="lg" onClick={onUpdate}>
            Update to current price
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <p className="text-sm text-amber-800">
          {count === 1
            ? `1 line on this ${documentLabel} carries a rate that differs from the current item master.`
            : `${count} lines on this ${documentLabel} carry rates that differ from the current item master.`}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 text-right font-medium">Saved price</th>
              <th className="px-4 py-3 text-right font-medium">Current price</th>
              <th className="px-4 py-3 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {differences.map((d) => (
              <tr key={d.variant_id}>
                <td className="px-4 py-3 font-medium text-slate-900">{d.item_name}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                  {formatMoney(d.old_rate)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                  {formatMoney(d.new_rate)}
                </td>
                <td
                  className={
                    d.difference > 0
                      ? 'px-4 py-3 text-right font-medium tabular-nums text-rose-600'
                      : 'px-4 py-3 text-right font-medium tabular-nums text-emerald-600'
                  }
                >
                  {d.difference > 0 ? '+' : ''}
                  {formatMoney(d.difference)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
