import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useSaveCustomer } from '@/services/catalog';
import { useSaveSupplier } from '@/services/operations';
import { ApiError } from '@/lib/api';

export interface InitialPartyData {
  id: string;
  type: 'Customer' | 'Supplier';
  name: string;
  mobile?: string;
  address?: string;
  gstin?: string;
  creditLimit?: number;
}

interface PartyFormModalProps {
  initialParty?: InitialPartyData | null;
  onClose: () => void;
}

export function PartyFormModal({ initialParty, onClose }: PartyFormModalProps): JSX.Element {
  const toast = useToast();
  const saveCustomer = useSaveCustomer();
  const saveSupplier = useSaveSupplier();

  const isEditing = !!initialParty;
  const [type, setType] = useState<'Customer' | 'Supplier'>(initialParty?.type ?? 'Customer');
  const [name, setName] = useState(initialParty?.name ?? '');
  const [mobile, setMobile] = useState(initialParty?.mobile ?? '');
  const [address, setAddress] = useState(initialParty?.address ?? '');
  const [gstin, setGstin] = useState(initialParty?.gstin ?? '');
  const [creditLimit, setCreditLimit] = useState(
    initialParty?.creditLimit ? String(initialParty.creditLimit) : '',
  );
  const [error, setError] = useState<string | null>(null);

  const saving = saveCustomer.isPending || saveSupplier.isPending;

  const submit = (): void => {
    setError(null);
    if (name.trim().length < 2) {
      setError('Party ka naam likhiye (kam se kam 2 akshar).');
      return;
    }

    const payload = {
      name: name.trim(),
      mobile: mobile.trim() || null,
      address: address.trim() || null,
      gstin: gstin.trim().toUpperCase() || null,
    };

    const onError = (e: unknown): void =>
      setError(e instanceof ApiError ? e.message : 'Party save nahi ho payi.');

    const onSuccess = (): void => {
      toast.success(
        isEditing
          ? `${type === 'Supplier' ? 'Mahajan' : 'Customer'} updated`
          : `${type === 'Supplier' ? 'Mahajan' : 'Customer'} added`,
        name.trim(),
      );
      onClose();
    };

    if (type === 'Supplier') {
      saveSupplier.mutate(
        { id: isEditing ? initialParty.id : undefined, payload },
        { onSuccess, onError },
      );
    } else {
      saveCustomer.mutate(
        {
          id: isEditing ? initialParty.id : undefined,
          payload: { ...payload, credit_limit: Number(creditLimit) || 0 },
        },
        { onSuccess, onError },
      );
    }
  };

  return (
    <Modal open onClose={onClose} title={isEditing ? 'Edit Party' : 'Add Party'}>
      <div className="space-y-4">
        {/* Header Badge */}
        <div className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
          <img
            src={isEditing ? '/images/items/editIcon.webp' : '/icons/parties/Parties.svg'}
            alt=""
            className="h-6 w-6 object-contain"
          />
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-bold text-slate-800">
              {isEditing ? `Edit ${initialParty.name}` : 'New Customer or Supplier'}
            </h4>
            <p className="text-[11px] text-slate-500">
              {type === 'Supplier' ? 'Mahajan (Vendor / Wholesaler)' : 'Customer (Grahak / Khata)'}
            </p>
          </div>
        </div>

        {/* Type selector */}
        <div>
          <Label>Party Type</Label>
          <div className="mt-1 flex gap-2">
            {(['Customer', 'Supplier'] as const).map((value) => {
              const active = type === value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={isEditing}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-all ${
                    active
                      ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  } ${isEditing ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}
                  onClick={() => setType(value)}
                >
                  {value === 'Supplier' ? 'Mahajan (Supplier)' : 'Customer (Grahak)'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Name */}
        <div className="space-y-1">
          <Label htmlFor="party-name">
            Party Name <span className="text-rose-500">*</span>
          </Label>
          <Input
            id="party-name"
            value={name}
            autoFocus={!isEditing}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ramesh Hardware, Rajesh Kumar"
          />
        </div>

        {/* Mobile */}
        <div className="space-y-1">
          <Label htmlFor="party-mobile">Mobile Number (WhatsApp)</Label>
          <div className="relative flex items-center">
            <span className="absolute left-3 text-xs font-medium text-slate-400">+91</span>
            <Input
              id="party-mobile"
              className="pl-11"
              value={mobile}
              inputMode="numeric"
              maxLength={10}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
              placeholder="9876543210"
            />
          </div>
        </div>

        {/* Address */}
        <div className="space-y-1">
          <Label htmlFor="party-address">Billing Address / Village</Label>
          <Input
            id="party-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. Ishuwapur, Saran, Bihar"
          />
        </div>

        {/* GSTIN */}
        <div className="space-y-1">
          <Label htmlFor="party-gstin">GSTIN (Optional)</Label>
          <Input
            id="party-gstin"
            value={gstin}
            maxLength={15}
            style={{ textTransform: 'uppercase' }}
            onChange={(e) => setGstin(e.target.value)}
            placeholder="15-digit GSTIN (e.g. 10ABCDE1234F1Z5)"
          />
        </div>

        {/* Credit Limit (only for customer) */}
        {type === 'Customer' && (
          <div className="space-y-1">
            <Label htmlFor="party-credit">Credit Limit (Udhaar ki seema)</Label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-xs font-semibold text-slate-400">₹</span>
              <Input
                id="party-credit"
                className="pl-7"
                value={creditLimit}
                inputMode="decimal"
                onChange={(e) => setCreditLimit(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}

        {/* Modal Actions */}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? 'Saving…' : isEditing ? 'Update Party' : 'Save Party'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
