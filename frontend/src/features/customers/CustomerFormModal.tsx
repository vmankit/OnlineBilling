import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useSaveCustomer } from '@/services/catalog';
import { ApiError } from '@/lib/api';
import type { Customer } from '@/types';

export function CustomerFormModal({
  customer,
  onClose,
  onCreated,
}: {
  customer: Customer | null;
  onClose: () => void;
  /** POS uses this to drop the new customer straight into the open bill. */
  onCreated?: (customer: Customer) => void;
}): JSX.Element {
  const toast = useToast();
  const save = useSaveCustomer();

  const [name, setName] = useState(customer?.name ?? '');
  const [mobile, setMobile] = useState(customer?.mobile ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [creditLimit, setCreditLimit] = useState(String(customer?.credit_limit ?? 0));
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [error, setError] = useState('');

  const onSubmit = async (): Promise<void> => {
    setError('');
    if (name.trim().length < 2) return setError('Enter the customer name.');
    try {
      const saved = await save.mutateAsync({
        id: customer?.id,
        payload: {
          name: name.trim(),
          mobile: mobile.trim(),
          email: email.trim(),
          address: address.trim() || null,
          credit_limit: Number(creditLimit) || 0,
          notes: notes.trim() || null,
          is_active: true,
        },
      });
      toast.success(customer ? 'Customer updated' : 'Customer added', name.trim());
      onCreated?.(saved);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save this customer.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={customer ? 'Edit customer' : 'New customer'}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void onSubmit()} loading={save.isPending}>
            {customer ? 'Save changes' : 'Add customer'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="cust-name" required>
            Customer name
          </Label>
          <Input
            id="cust-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ramesh Kumar Constructions"
            autoFocus
          />
        </div>

        <div>
          <Label htmlFor="cust-mobile">Mobile</Label>
          <Input
            id="cust-mobile"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="9835012345"
            inputMode="tel"
            type="tel"
          />
        </div>

        <div>
          <Label htmlFor="cust-email">Email</Label>
          <Input
            id="cust-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="optional"
            inputMode="email"
            type="email"
            autoCapitalize="none"
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="cust-address">Address</Label>
          <Textarea
            id="cust-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Main Road, Ishuwapur, Saran"
          />
        </div>


        <div>
          <Label htmlFor="cust-credit">Credit limit ₹</Label>
          <Input
            id="cust-credit"
            value={creditLimit}
            onChange={(e) => setCreditLimit(e.target.value)}
            inputMode="decimal"
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="cust-notes">Notes</Label>
          <Textarea id="cust-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
      </div>

      <FieldError>{error}</FieldError>
    </Modal>
  );
}
