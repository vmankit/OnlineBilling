import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useBrands, useCategories, useItemGroups, useSaveItem, useUnits } from '@/services/catalog';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Item, ItemVariant } from '@/types';

interface VariantDraft {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  pack_size: string;
  pack_unit: string;
  purchase_price: string;
  selling_price: string;
  mrp: string;
  min_stock: string;
  is_default: boolean;
  is_active: boolean;
}

const emptyVariant = (packUnit: string): VariantDraft => ({
  name: '',
  sku: '',
  barcode: '',
  pack_size: '1',
  pack_unit: packUnit,
  purchase_price: '0',
  selling_price: '0',
  mrp: '0',
  min_stock: '0',
  is_default: false,
  is_active: true,
});

const toDraft = (v: ItemVariant): VariantDraft => ({
  id: v.id,
  name: v.name,
  sku: v.sku,
  barcode: v.barcode ?? '',
  pack_size: String(v.pack_size),
  pack_unit: v.pack_unit,
  purchase_price: String(v.purchase_price),
  selling_price: String(v.selling_price),
  mrp: String(v.mrp),
  min_stock: String(v.min_stock),
  is_default: v.is_default,
  is_active: v.is_active,
});

export function ItemFormModal({ item, onClose }: { item: Item | null; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const units = useUnits();
  const brands = useBrands();
  const categories = useCategories();
  const groups = useItemGroups();
  const save = useSaveItem();

  const [name, setName] = useState(item?.name ?? '');
  const [itemCode, setItemCode] = useState(item?.item_code ?? '');
  const [stockUnit, setStockUnit] = useState(item?.stock_unit ?? 'PCS');
  const [brandId, setBrandId] = useState(item?.brand_id ?? '');
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '');
  const [groupId, setGroupId] = useState(item?.item_group_id ?? '');
  const [hsn, setHsn] = useState(item?.hsn_code ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [isActive, setIsActive] = useState(item?.is_active ?? true);
  const [variants, setVariants] = useState<VariantDraft[]>(
    item?.variants.length ? item.variants.map(toDraft) : [{ ...emptyVariant('PCS'), is_default: true }],
  );
  const [error, setError] = useState('');

  // Packaging is normally expressed in the same physical dimension as stock:
  // a litre-stocked paint comes in 1/4/10/20 L tins.
  const packUnitOptions = useMemo(
    () => units.data ?? [],
    [units.data],
  );

  const updateVariant = (index: number, patch: Partial<VariantDraft>): void => {
    setVariants((list) => list.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  };

  const setDefaultVariant = (index: number): void => {
    setVariants((list) => list.map((v, i) => ({ ...v, is_default: i === index })));
  };

  const removeVariant = (index: number): void => {
    setVariants((list) => (list.length === 1 ? list : list.filter((_, i) => i !== index)));
  };

  const onSubmit = async (): Promise<void> => {
    setError('');

    if (name.trim().length < 2) return setError('Enter the item name.');
    if (!itemCode.trim()) return setError('Enter an item code.');
    if (variants.some((v) => !v.name.trim() || !v.sku.trim())) {
      return setError('Every packaging variant needs a name and an SKU.');
    }
    if (variants.some((v) => Number(v.pack_size) <= 0)) {
      return setError('Pack size must be greater than zero.');
    }

    const payload = {
      name: name.trim(),
      item_code: itemCode.trim(),
      description: description.trim() || null,
      item_group_id: groupId || null,
      brand_id: brandId || null,
      category_id: categoryId || null,
      hsn_code: hsn.trim() || null,
      tax_rate: 0,
      stock_unit: stockUnit,
      is_active: isActive,
      variants: variants.map((v) => ({
        ...(v.id ? { id: v.id } : {}),
        name: v.name.trim(),
        sku: v.sku.trim(),
        barcode: v.barcode.trim() || null,
        pack_size: Number(v.pack_size),
        pack_unit: v.pack_unit,
        purchase_price: Number(v.purchase_price) || 0,
        selling_price: Number(v.selling_price) || 0,
        mrp: Number(v.mrp) || 0,
        min_stock: Number(v.min_stock) || 0,
        is_default: v.is_default,
        is_active: v.is_active,
      })),
    };

    try {
      await save.mutateAsync({ id: item?.id, payload });
      toast.success(item ? 'Item updated' : 'Item created', name.trim());
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save this item.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-amber-50 border border-amber-200/80 p-1.5 flex items-center justify-center shadow-2xs">
            <img
              src={item ? '/images/items/editIcon.webp' : '/icons/items/add_items.svg'}
              alt=""
              className="h-5 w-5 object-contain"
            />
          </div>
          <div>
            <span className="text-base font-bold text-slate-900 block leading-tight">
              {item ? `Edit Item: ${item.name}` : 'Add New Item'}
            </span>
            <span className="text-[11px] font-normal text-slate-500">
              Set selling rate, purchase cost, barcode and packaging variants
            </span>
          </div>
        </div>
      }
      description=""
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void onSubmit()} loading={save.isPending} className="bg-[#e8453c] hover:bg-[#d13c34]">
            {item ? 'Save changes' : 'Create item'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <Label htmlFor="item-name" required>
            Item name
          </Label>
          <Input
            id="item-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Asian Paints Apex Ultima Exterior Emulsion"
            autoFocus
          />
        </div>

        <div>
          <Label htmlFor="item-code" required>
            Item code
          </Label>
          <Input
            id="item-code"
            value={itemCode}
            onChange={(e) => setItemCode(e.target.value.toUpperCase())}
            placeholder="AP-APEXULT"
            className="font-mono"
            autoCapitalize="characters"
          />
        </div>

        <div>
          <Label htmlFor="stock-unit" required>
            Stock unit
          </Label>
          <Select id="stock-unit" value={stockUnit} onChange={(e) => {
            const next = e.target.value;
            // Packs that were counted in the old stock unit follow it to the new one.
            setVariants((list) => list.map((v) => (v.pack_unit === stockUnit ? { ...v, pack_unit: next } : v)));
            setStockUnit(next);
          }}>
            {units.data?.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name} ({u.code})
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-slate-500">
            Inventory is held and reported in this unit. Sales in other units convert automatically.
          </p>
        </div>

        <div>
          <Label htmlFor="brand">Brand</Label>
          <Select id="brand" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">—</option>
            {brands.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="category">Category</Label>
          <Select id="category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">—</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="group">Item group</Label>
          <Select id="group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">—</option>
            {groups.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="hsn">HSN code</Label>
          <Input
            id="hsn"
            value={hsn}
            onChange={(e) => setHsn(e.target.value)}
            placeholder="3209"
            inputMode="numeric"
          />
          <p className="mt-1.5 text-xs text-slate-500">
            Optional product code. Searchable, but not printed on bills.
          </p>
        </div>

        <div className="lg:col-span-2">
          <Label htmlFor="desc">Description</Label>
          <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <div className="mt-7">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Packaging variants</h3>
            <p className="text-sm text-slate-500">
              Each row is independently sellable with its own barcode, price and stock.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setVariants((list) => [...list, emptyVariant(stockUnit)])}
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>

        <div className="space-y-3">
          {variants.map((v, index) => (
            <div
              key={v.id ?? index}
              className={cn(
                'rounded-2xl border p-4',
                v.is_default ? 'border-brand-200 bg-brand-50/40' : 'border-slate-200 bg-white',
              )}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <Label>Pack name</Label>
                  <Input
                    value={v.name}
                    onChange={(e) => updateVariant(index, { name: e.target.value })}
                    placeholder="20 L"
                  />
                </div>
                <div>
                  <Label>SKU</Label>
                  <Input
                    value={v.sku}
                    onChange={(e) => updateVariant(index, { sku: e.target.value.toUpperCase() })}
                    placeholder="AP-APEXULT-20L"
                    className="font-mono"
                  />
                </div>
                <div>
                  <Label className="flex items-center gap-1">
                    <img src="/icons/items/default-barcode.svg" alt="" className="h-3.5 w-3.5 opacity-70" />
                    <span>Barcode</span>
                  </Label>
                  <Input
                    value={v.barcode}
                    onChange={(e) => updateVariant(index, { barcode: e.target.value })}
                    placeholder="8901234500042"
                    className="font-mono"
                    inputMode="numeric"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Pack size</Label>
                    <Input
                      value={v.pack_size}
                      onChange={(e) => updateVariant(index, { pack_size: e.target.value })}
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <Label>Unit</Label>
                    <Select
                      value={v.pack_unit}
                      onChange={(e) => updateVariant(index, { pack_unit: e.target.value })}
                    >
                      {packUnitOptions.map((u) => (
                        <option key={u.code} value={u.code}>
                          {u.code}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Purchase ₹</Label>
                  <Input
                    value={v.purchase_price}
                    onChange={(e) => updateVariant(index, { purchase_price: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <Label>Selling ₹</Label>
                  <Input
                    value={v.selling_price}
                    onChange={(e) => updateVariant(index, { selling_price: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <Label>MRP ₹</Label>
                  <Input
                    value={v.mrp}
                    onChange={(e) => updateVariant(index, { mrp: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <Label>Min stock ({stockUnit})</Label>
                  <Input
                    value={v.min_stock}
                    onChange={(e) => updateVariant(index, { min_stock: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <input
                    type="radio"
                    name="default-variant"
                    checked={v.is_default}
                    onChange={() => setDefaultVariant(index)}
                    className="h-4 w-4 accent-brand-600"
                  />
                  Default pack
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={v.is_active}
                    onChange={(e) => updateVariant(index, { is_active: e.target.checked })}
                    className="h-4 w-4 accent-brand-600"
                  />
                  Active
                </label>
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeVariant(index)}
                  disabled={variants.length === 1}
                  className="text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <label className="mt-5 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4 accent-brand-600"
        />
        Item is active and available for billing
      </label>

      <FieldError>{error}</FieldError>
    </Modal>
  );
}
