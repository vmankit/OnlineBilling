import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import {
  useCancelExpense, useExpenseCategories, useExpenses, useSaveExpense, type Expense,
} from '@/services/operations';
import { ApiError } from '@/lib/api';

/**
 * Daily expenses — tea, transport, labour, salary, rent, electricity.
 *
 * Laid out like the Purchase screen and styled by the same
 * `santu_purchase.css`, since the old app kept the two side by side under
 * "Purchase & Expense". A wrong entry is cancelled with a reason, never
 * deleted, so the day's cash still adds up against what was written.
 */

const PERIODS = ['Today', 'This Month', 'Last Month', 'This Year', 'All Time'] as const;
type Period = (typeof PERIODS)[number];

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function rangeFor(period: Period, now = new Date()): { from: string; to: string } | null {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case 'Today':
      return { from: iso(now), to: iso(now) };
    case 'This Month':
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'Last Month':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'This Year':
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    case 'All Time':
      return null;
  }
}

const money = (value: number): string =>
  `₹ ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const asUserDate = (value: string): string =>
  new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function ExpensesPage(): JSX.Element {
  const [period, setPeriod] = useState<Period>('This Month');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<Expense | null>(null);

  const range = rangeFor(period);
  const { data, isLoading } = useExpenses({
    from: range?.from,
    to: range?.to,
    category: category || undefined,
    page,
  });
  const { data: categories } = useExpenseCategories();
  const rows = data?.data ?? [];

  return (
    <div className="santu-purchase">
      <div className="santu-purchase-page-header">
        <div className="santu-purchase-page-title">
          <span className="santu-purchase-title-text">Expenses</span>
        </div>
        <div className="santu-purchase-header-actions">
          <button
            type="button"
            className="btn btn-primary santu-purchase-add-btn"
            onClick={() => setAdding(true)}
          >
            + Add Expense
          </button>
        </div>
      </div>

      <div className="santu-purchase-filter-bar">
        <select
          className="santu-purchase-pill santu-purchase-period"
          aria-label="Time period"
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value as Period);
            setPage(1);
          }}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className="santu-purchase-pill"
          aria-label="Category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All Categories</option>
          {categories?.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="santu-purchase-summary-wrap">
        <div className="santu-purchase-total-payable">
          <div className="santu-purchase-total-payable-label">Total Kharcha</div>
          <div className="santu-purchase-total-payable-amount santu-figures">
            {money(data?.summary.total ?? 0)}
          </div>
          <div className="santu-purchase-total-payable-sub">
            {range ? `${asUserDate(range.from)} – ${asUserDate(range.to)}` : 'Sab din'}
          </div>
        </div>
        {(data?.summary.byCategory.length ?? 0) > 0 && (
          <div className="santu-expense-cats">
            {data!.summary.byCategory.map((c) => (
              <button
                key={c.category}
                type="button"
                className={`santu-expense-cat${category === c.category ? ' is-active' : ''}`}
                onClick={() => {
                  setCategory((cur) => (cur === c.category ? '' : c.category));
                  setPage(1);
                }}
              >
                <span>{c.category}</span>
                <b>{money(c.total)}</b>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="santu-purchase-txn-wrap">
        <div className="santu-purchase-txn-card-inner">
          <div className="santu-purchase-txn-header">
            <span className="santu-purchase-txn-title">KHARCHE</span>
          </div>

          {rows.length === 0 ? (
            <div className="santu-purchase-empty">
              {isLoading ? 'Loading…' : 'Is date range me koi kharcha darj nahi hai.'}
            </div>
          ) : (
            <div className="santu-purchase-txn-table-wrap">
              <table className="santu-purchase-txn-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>No.</th>
                    <th>Category</th>
                    <th>Kisko diya</th>
                    <th>Mode</th>
                    <th className="num">Amount</th>
                    <th className="num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => {
                    const cancelled = e.status === 'CANCELLED';
                    return (
                      <tr
                        key={e.id}
                        className="santu-purchase-txn-row"
                        style={cancelled ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}
                        title={cancelled ? `Cancelled: ${e.cancel_reason ?? ''}` : e.notes ?? undefined}
                      >
                        <td>{asUserDate(e.expense_date)}</td>
                        <td>{e.expense_number}</td>
                        <td>{e.category}</td>
                        <td>{e.paid_to || '—'}</td>
                        <td>{e.method}</td>
                        <td className="num santu-figures">{money(Number(e.amount))}</td>
                        <td className="num santu-purchase-row-actions">
                          {!cancelled && (
                            <button
                              type="button"
                              className="santu-purchase-row-btn"
                              title="Galat entry — cancel karein"
                              onClick={() => setCancelling(e)}
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data && data.totalPages > 1 && (
            <div className="santu-sale-txn-footer">
              <span>
                Page {data.page} of {data.totalPages}
              </span>
              <div className="santu-sale-pager">
                <button
                  type="button"
                  className="santu-sale-pager-btn"
                  disabled={data.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ‹ Previous
                </button>
                <button
                  type="button"
                  className="santu-sale-pager-btn"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next ›
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {adding && <ExpenseFormModal categories={categories ?? []} onClose={() => setAdding(false)} />}
      {cancelling && <CancelExpenseModal expense={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}

function ExpenseFormModal({ categories, onClose }: { categories: string[]; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const save = useSaveExpense();
  const [category, setCategory] = useState(categories[0] ?? 'Other');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [date, setDate] = useState(iso(new Date()));
  const [paidTo, setPaidTo] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    setError(null);
    const value = Number(amount);
    if (!(value > 0)) {
      setError('Rakam likhiye.');
      return;
    }
    save.mutate(
      {
        category, amount: value, method, expense_date: date,
        paid_to: paidTo.trim() || null, notes: notes.trim() || null,
      },
      {
        onSuccess: (e) => {
          toast.success('Kharcha darj ho gaya', `${e.expense_number} — ${money(value)}`);
          onClose();
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : 'Save nahi hua.'),
      },
    );
  };

  return (
    <Modal open onClose={onClose} title="Add Expense">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="exp-cat">Category</Label>
            <Select id="exp-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="exp-amount">Rakam</Label>
            <Input
              id="exp-amount"
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="exp-date">Date</Label>
            <Input id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="exp-method">Kaise diya</Label>
            <Select id="exp-method" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="BANK">Bank</option>
              <option value="CARD">Card</option>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="exp-to">Kisko diya (optional)</Label>
          <Input id="exp-to" value={paidTo} onChange={(e) => setPaidTo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="exp-notes">Note (optional)</Label>
          <Input id="exp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CancelExpenseModal({ expense, onClose }: { expense: Expense; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const cancel = useCancelExpense();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal open onClose={onClose} title={`Cancel ${expense.expense_number}?`}>
      <div className="space-y-4 text-sm">
        <p>
          {expense.category} — {money(Number(expense.amount))}. Entry list me rahegi, bas total me nahi
          judegi.
        </p>
        <div className="space-y-1">
          <Label htmlFor="exp-reason">Kyun cancel kar rahe hain?</Label>
          <Input id="exp-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <p className="text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={cancel.isPending}>
            Rehne dein
          </Button>
          <Button
            disabled={cancel.isPending}
            onClick={() => {
              if (reason.trim().length < 3) {
                setError('Wajah likhiye (kam se kam 3 akshar).');
                return;
              }
              cancel.mutate(
                { id: expense.id, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success('Entry cancel ho gayi');
                    onClose();
                  },
                  onError: (e) => setError(e instanceof ApiError ? e.message : 'Cancel nahi hua.'),
                },
              );
            }}
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel entry'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
