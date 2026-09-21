import { useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useItems } from '@/services/catalog';
import { useCreatePurchase, useSuppliers } from '@/services/operations';
import { useDebounced } from '@/hooks/useDebounced';
import { ApiError } from '@/lib/api';
import { formatMoney, formatQty } from '@/lib/utils';
import type { Item, ItemVariant } from '@/types';

interface PurchaseLine {
  key: string;
  variantId: string;
  label: string;
  packUnit: string;
  stockUnit: string;
  quantity: string;
  purchaseUnit: string;
  rate: string;
  discount: string;
  currentPurchasePrice: number;
  currentSellingPrice: number;
  updatePurchasePrice: boolean;
  newSellingPrice: string;
}

export function PurchaseFormModal({ onClose }: { onClose: () => void }): JSX.Element {
  const toast = useToast();
  const create = useCreatePurchase();
  const suppliers = useSuppliers({});

  const [supplierId, setSupplierId] = useState('');
  const [supplierInvoice, setSupplierInvoice] = useState('');
  const [paid, setPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const debounced = useDebounced(search, 250);
  const { data: items } = useItems({ q: debounced, pageSize: 12 });

  const addLine = (item: Item, variant: ItemVariant): void => {
    setLines((prev) => [
      ...prev,
      {
        key: `${variant.id}-${Date.now()}`,
        variantId: variant.id,
        label: `${item.name} · ${variant.name}`,
        packUnit: variant.pack_unit,
        stockUnit: item.stock_unit,
        quantity: '1',
        purchaseUnit: variant.pack_unit,
        rate: String(variant.purchase_price),
        discount: '0',
        currentPurchasePrice: Number(variant.purchase_price),
        currentSellingPrice: Number(variant.selling_price),
        updatePurchasePrice: false,
        newSellingPrice: '',
      },
    ]);
    setSearch('');
  };

  const update = (key: string, patch: Partial<PurchaseLine>): void =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const remove = (key: string): void => setLines((prev) => prev.filter((l) => l.key !== key));

  const total = useMemo(
    () =>
      lines.reduce(
        (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.rate) || 0) - (Number(l.discount) || 0),
        0,
      ),
    [lines],
  );
  const due = Math.max(0, total - (Number(paid) || 0));

  const submit = async (): Promise<void> => {
    setError('');
    if (!supplierId) return setError('Choose the supplier this stock came from.');
    if (lines.length === 0) return setError('Add at least one item to the purchase.');
    if (lines.some((l) => Number(l.quantity) <= 0)) return setError('Every line needs a quantity.');

    try {
      const purchase = await create.mutateAsync({
        supplier_id: supplierId,
        supplier_invoice_number: supplierInvoice.trim() || null,
        paid_amount: Number(paid) || 0,
        notes: notes.trim() || null,
        items: lines.map((l) => ({
          variant_id: l.variantId,
          quantity: Number(l.quantity),
          purchase_unit: l.purchaseUnit,
          rate: Number(l.rate) || 0,
          discount_amt: Number(l.discount) || 0,
          update_purchase_price: l.updatePurchasePrice,
          new_selling_price: l.newSellingPrice === '' ? null : Number(l.newSellingPrice),
        })),
      });
      toast.success('Purchase recorded', `${purchase.purchase_number} · stock updated`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save this purchase.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="New purchase"
      description="Stock increases the moment this is saved, through the stock ledger."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={create.isPending}>
            Save purchase · {formatMoney(total)}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="pur-supplier" required>
            Supplier
          </Label>
          <Select id="pur-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Choose…</option>
            {suppliers.data?.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="pur-inv">Supplier invoice no.</Label>
          <Input
            id="pur-inv"
            value={supplierInvoice}
            onChange={(e) => setSupplierInvoice(e.target.value)}
            placeholder="As printed on their bill"
          />
        </div>
        <div>
          <Label htmlFor="pur-paid">Paid now ₹</Label>
          <Input id="pur-paid" value={paid} onChange={(e) => setPaid(e.target.value)} inputMode="decimal" placeholder="0" />
        </div>
      </div>

      <div className="mt-6">
        <Label>Add items</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, code or barcode…"
            className="h-12 pl-12"
          />
        </div>

        {debounced && items && (
          <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-slate-200">
            {items.data.length === 0 && (
              <p className="p-4 text-center text-sm text-slate-400">No item matches that search.</p>
            )}
            {items.data.flatMap((item) =>
              item.variants
                .filter((v) => v.is_active)
                .map((v) => (
                  <button
                    key={v.id}
                    onClick={() => addLine(item, v)}
                    className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {item.name} · {v.name}
                      </p>
                      <p className="font-mono text-xs text-slate-400">{v.sku}</p>
                    </div>
                    <span className="shrink-0 text-sm text-slate-500">
                      {formatQty(v.stock)} {item.stock_unit}
                    </span>
                    <Plus className="h-4 w-4 shrink-0 text-brand-600" />
                  </button>
                )),
            )}
          </div>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {lines.map((line) => (
          <div key={line.key} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{line.label}</p>
              <button
                onClick={() => remove(line.key)}
                className="touch-target flex items-center justify-center rounded-xl text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                aria-label="Remove line"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <label className="text-xs text-slate-500">
                Quantity
                <Input
                  value={line.quantity}
                  onChange={(e) => update(line.key, { quantity: e.target.value })}
                  inputMode="decimal"
                  className="mt-1 h-11"
                />
              </label>
              <label className="text-xs text-slate-500">
                Unit
                <Select
                  value={line.purchaseUnit}
                  onChange={(e) => update(line.key, { purchaseUnit: e.target.value })}
                  className="mt-1 h-11"
                >
                  {[...new Set([line.packUnit, line.stockUnit])].map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="text-xs text-slate-500">
                Rate ₹
                <Input
                  value={line.rate}
                  onChange={(e) => update(line.key, { rate: e.target.value })}
                  inputMode="decimal"
                  className="mt-1 h-11"
                />
              </label>
              <label className="text-xs text-slate-500">
                Discount ₹
                <Input
                  value={line.discount}
                  onChange={(e) => update(line.key, { discount: e.target.value })}
                  inputMode="decimal"
                  className="mt-1 h-11"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={line.updatePurchasePrice}
                  onChange={(e) => update(line.key, { updatePurchasePrice: e.target.checked })}
                  className="h-4 w-4 accent-brand-600"
                />
                Update cost price (now {formatMoney(line.currentPurchasePrice)})
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                New selling price ₹
                <Input
                  value={line.newSellingPrice}
                  onChange={(e) => update(line.key, { newSellingPrice: e.target.value })}
                  placeholder={String(line.currentSellingPrice)}
                  inputMode="decimal"
                  className="h-11 w-28"
                />
              </label>
              <span className="ml-auto text-sm font-semibold text-slate-900">
                {formatMoney((Number(line.quantity) || 0) * (Number(line.rate) || 0) - (Number(line.discount) || 0))}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <Label htmlFor="pur-notes">Notes</Label>
        <Textarea id="pur-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-6 border-t border-slate-100 pt-4 text-sm">
        <span className="text-slate-500">
          Total <strong className="ml-1 text-base text-slate-900">{formatMoney(total)}</strong>
        </span>
        <span className="text-slate-500">
          Due{' '}
          <strong className={due > 0 ? 'ml-1 text-base text-rose-600' : 'ml-1 text-base text-emerald-600'}>
            {formatMoney(due)}
          </strong>
        </span>
      </div>

      <FieldError>{error}</FieldError>
    </Modal>
  );
}
