import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { useAuth } from '@/features/auth/AuthProvider';
import { LoginPage } from '@/pages/LoginPage';
import { PosPage } from '@/features/pos/PosPage';

/**
 * Route-level code splitting.
 *
 * Login and the POS ship in the first bundle — those are the two screens a
 * shop actually opens, and the counter cannot wait for a chunk to download
 * mid-sale. Everything a cashier may never touch (reports, purchases, invoice
 * templates) is fetched on first visit instead, which keeps the initial
 * download small over a patchy shop connection.
 */
function page<T extends string>(
  loader: () => Promise<Record<T, ComponentType>>,
  name: T,
): LazyExoticComponent<ComponentType> {
  return lazy(async () => ({ default: (await loader())[name] as ComponentType }));
}

const DashboardPage = page(() => import('@/pages/DashboardPage'), 'DashboardPage');
const SalesPage = page(() => import('@/pages/SalesPage'), 'SalesPage');
const QuotationsPage = page(() => import('@/pages/QuotationsPage'), 'QuotationsPage');
const QuotationDetailPage = page(
  () => import('@/pages/QuotationDetailPage'),
  'QuotationDetailPage',
);
const SaleDetailPage = page(() => import('@/pages/SaleDetailPage'), 'SaleDetailPage');
const ItemsPage = page(() => import('@/pages/ItemsPage'), 'ItemsPage');
const PartiesPage = page(() => import('@/pages/PartiesPage'), 'PartiesPage');
const ExpensesPage = page(() => import('@/pages/ExpensesPage'), 'ExpensesPage');
const CustomerDetailPage = page(() => import('@/pages/CustomerDetailPage'), 'CustomerDetailPage');
const PurchasesPage = page(() => import('@/pages/PurchasesPage'), 'PurchasesPage');
const StockPage = page(() => import('@/pages/StockPage'), 'StockPage');
const ReportsPage = page(() => import('@/pages/ReportsPage'), 'ReportsPage');
const InvoiceTemplatesPage = page(
  () => import('@/pages/InvoiceTemplatesPage'),
  'InvoiceTemplatesPage',
);
const UtilitiesPage = page(() => import('@/pages/UtilitiesPage'), 'UtilitiesPage');
const ImportItemsPage = page(() => import('@/pages/ImportItemsPage'), 'ImportItemsPage');
const WhatsAppPage = page(() => import('@/pages/WhatsAppPage'), 'WhatsAppPage');
const PublicBillPage = page(() => import('@/pages/PublicBillPage'), 'PublicBillPage');
const SalesReturnsPage = page(() => import('@/pages/SalesReturnsPage'), 'SalesReturnsPage');

function Spinner(): JSX.Element {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>
  );
}

function RequireAuth({ children }: { children: JSX.Element }): JSX.Element {
  const { status } = useAuth();

  if (status === 'loading') return <Spinner />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return children;
}

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/bill/:id"
        element={
          <Suspense fallback={<Spinner />}>
            <PublicBillPage />
          </Suspense>
        }
      />
      <Route
        path="/invoice/:id"
        element={
          <Suspense fallback={<Spinner />}>
            <PublicBillPage />
          </Suspense>
        }
      />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        {/* Eager: the billing screen must open instantly. */}
        <Route path="/pos" element={<PosPage />} />

        {/* One boundary inside the shell, so the sidebar never flickers while
            a page chunk is still downloading. */}
        <Route
          element={
            <Suspense fallback={<Spinner />}>
              <Outlet />
            </Suspense>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/sales/:id" element={<SaleDetailPage />} />
          <Route path="/sales-returns" element={<SalesReturnsPage />} />
          <Route path="/quotations" element={<QuotationsPage />} />
          <Route path="/quotations/:id" element={<QuotationDetailPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/parties" element={<PartiesPage />} />
          {/* Customers and Suppliers are one Parties screen now. */}
          <Route path="/customers" element={<Navigate to="/parties" replace />} />
          <Route path="/suppliers" element={<Navigate to="/parties" replace />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route path="/purchases" element={<PurchasesPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/invoice-templates" element={<InvoiceTemplatesPage />} />
          <Route path="/utilities" element={<UtilitiesPage />} />
          <Route path="/import-items" element={<ImportItemsPage />} />
          <Route path="/whatsapp" element={<WhatsAppPage />} />
          {/* Settings was the shop profile again — Utilities already has it. */}
          <Route path="/settings" element={<Navigate to="/utilities?tab=shop_profile" replace />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
