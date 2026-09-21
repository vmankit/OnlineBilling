import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Receipt, Wallet } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useCustomer } from '@/services/catalog';
import { useAuth } from '@/features/auth/AuthProvider';
import { formatDate, formatMoney } from '@/lib/utils';
import { CustomerFormModal } from '@/features/customers/CustomerFormModal';

export function CustomerDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data, isLoading, isError } = useCustomer(id);
  const [editing, setEditing] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4 p-4 lg:p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-4 lg:p-8">
        <Card>
          <EmptyState
            title="Customer not found"
            description="This customer may have been removed."
            action={
              <Link to="/parties">
                <Button variant="secondary">Back to customers</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const creditUsed = data.credit_limit > 0 ? (data.outstanding_balance / data.credit_limit) * 100 : 0;

  return (
    <>
      <div className="px-4 pb-10 pt-6 lg:px-8">
        <Link
          to="/parties"
          className="mb-4 inline-flex touch-target items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          All customers
        </Link>

        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{data.name}</h1>
            <p className="mt-1 text-[15px] text-slate-500">
              {data.mobile || 'No mobile'}
              {data.address ? ` · ${data.address}` : ''}
            </p>
          </div>
          {can('customer:update') && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          )}
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Total purchases" value={formatMoney(data.stats.total_purchases)} />
          <StatTile label="Invoices" value={String(data.stats.invoice_count)} />
          <StatTile
            label="Outstanding"
            value={formatMoney(data.outstanding_balance)}
            tone={data.outstanding_balance > 0 ? 'danger' : 'default'}
          />
          <StatTile
            label="Credit limit"
            value={data.credit_limit > 0 ? formatMoney(data.credit_limit) : 'Not set'}
            hint={
              data.credit_limit > 0 ? `${Math.min(100, Math.round(creditUsed))}% used` : undefined
            }
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader title="Invoice history" description="Most recent 50 bills" />
            {data.invoices.length === 0 ? (
              <EmptyState icon={<Receipt className="h-6 w-6" />} title="No invoices yet" />
            ) : (
              <div className="divide-y divide-slate-100">
                {data.invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-medium text-slate-900">
                        {inv.invoice_number}
                      </p>
                      <p className="text-sm text-slate-500">{formatDate(inv.invoice_date)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold text-slate-900">{formatMoney(inv.grand_total)}</p>
                      {inv.due_amount > 0 && (
                        <p className="text-xs text-rose-600">{formatMoney(inv.due_amount)} due</p>
                      )}
                    </div>
                    <Badge
                      tone={
                        inv.status === 'CANCELLED'
                          ? 'slate'
                          : inv.payment_status === 'PAID'
                            ? 'green'
                            : inv.payment_status === 'PARTIAL'
                              ? 'amber'
                              : 'red'
                      }
                    >
                      {inv.status === 'CANCELLED' ? 'Cancelled' : inv.payment_status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Payment history" description="Most recent 50 receipts" />
            {data.payments.length === 0 ? (
              <EmptyState icon={<Wallet className="h-6 w-6" />} title="No payments recorded" />
            ) : (
              <div className="divide-y divide-slate-100">
                {data.payments.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-medium text-slate-900">{p.payment_number}</p>
                      <p className="text-sm text-slate-500">
                        {formatDate(p.payment_date)}
                        {p.methods.length > 0 &&
                          ` · ${p.methods.map((m) => m.method).join(' + ')}`}
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold text-emerald-600">{formatMoney(p.amount)}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {editing && <CustomerFormModal customer={data} onClose={() => setEditing(false)} />}
    </>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'danger';
}): JSX.Element {
  return (
    <Card>
      <CardBody className="p-5">
        <p className="text-sm text-slate-500">{label}</p>
        <p
          className={
            tone === 'danger'
              ? 'mt-1.5 text-2xl font-semibold tracking-tight text-rose-600'
              : 'mt-1.5 text-2xl font-semibold tracking-tight text-slate-900'
          }
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      </CardBody>
    </Card>
  );
}
