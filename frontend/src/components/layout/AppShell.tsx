import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  Home, Users, Package, Receipt, RotateCcw, ShoppingCart, MessageSquare,
  Wrench, Search, Mic,
  Plus, ChevronLeft, ChevronRight, ChevronDown, Calculator, RotateCw, LogOut, WifiOff,
  X, MoreVertical, Clock,
} from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { WhatsAppModal } from '@/features/whatsapp/WhatsAppModal';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  iconColor: string;
  badge?: string;
  permission?: string;
  hasChevron?: boolean;
  onClick?: () => void;
}

export function AppShell(): JSX.Element {
  const { user, logout, can } = useAuth();
  // Expanded by default to match Santu Hardware screenshots
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [whatsappExpanded, setWhatsappExpanded] = useState(true);
  const [utilitiesExpanded, setUtilitiesExpanded] = useState(true);
  const [saleExpanded, setSaleExpanded] = useState(true);
  const [purchaseExpanded, setPurchaseExpanded] = useState(false);
  const [itemsExpanded, setItemsExpanded] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [headerSearch, setHeaderSearch] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const online = useOnlineStatus();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const navItems: NavItem[] = [
    { to: '/dashboard', label: 'Home', icon: Home, iconColor: 'text-sky-400' },
    { to: '/parties', label: 'Parties', icon: Users, iconColor: 'text-purple-400', permission: 'customer:view' },
    { to: '/items', label: 'Items', icon: Package, iconColor: 'text-amber-400', permission: 'item:view', hasChevron: true },
    { to: '/pos', label: 'Sale', icon: Receipt, iconColor: 'text-emerald-400', permission: 'sale:create', hasChevron: true },
    { to: '/sales-returns', label: 'Sale Return', icon: RotateCcw, iconColor: 'text-cyan-400', permission: 'sale:view' },
    { to: '/purchases', label: 'Purchase & Expense', icon: ShoppingCart, iconColor: 'text-orange-400', permission: 'purchase:view', hasChevron: true },
    {
      to: '/whatsapp',
      label: 'WhatsApp',
      icon: MessageSquare,
      iconColor: 'text-emerald-400',
    },
    { to: '/utilities', label: 'Utilities', icon: Wrench, iconColor: 'text-indigo-400' },
  ];

  const visibleNav = navItems.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#f4f7fb] font-sans">
      {/* ----------------- TOP HEADER BAR ----------------- */}
      <header
        className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200/90 bg-white px-3 sm:px-4 select-none z-30"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        {/* Left: Brand Logo */}
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden h-8 w-8 text-slate-700"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
          <Link to="/dashboard" className="flex items-center tracking-tight">
            <span className="text-[17px] font-extrabold text-slate-900 tracking-tight">
              Santu <span className="text-[#E03131]">Hardware</span>
            </span>
          </Link>
        </div>

        {/* Center: Search Transactions pill */}
        <div className="flex-1 max-w-sm mx-2 hidden sm:block">
          <div className="relative flex items-center">
            <input
              type="text"
              value={headerSearch}
              onChange={(e) => setHeaderSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && headerSearch.trim()) {
                  navigate(`/sales?q=${encodeURIComponent(headerSearch.trim())}`);
                }
              }}
              placeholder="Search Transactions"
              className="w-full h-8 pl-8 pr-7 text-xs rounded-full border border-slate-200 bg-slate-50/70 hover:bg-slate-50 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors text-slate-700 placeholder-slate-400"
            />
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <button
              type="button"
              title="Voice Search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <Mic className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Right: Quick action pills and controls */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* + Add Sale */}
          <Link
            to="/pos"
            className="inline-flex items-center gap-1 rounded-full border border-[#1877F2] bg-white px-3 py-1 text-xs font-semibold text-[#1877F2] hover:bg-blue-50 transition-colors shadow-2xs whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Sale</span>
          </Link>

          {/* + Receive Stock */}
          <Link
            to="/purchases"
            className="hidden md:inline-flex items-center gap-1 rounded-full border border-[#1877F2] bg-white px-3 py-1 text-xs font-semibold text-[#1877F2] hover:bg-blue-50 transition-colors shadow-2xs whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Receive Stock</span>
          </Link>

          {/* + quick button */}
          <Link
            to="/pos"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-slate-600 hover:border-blue-500 hover:text-blue-600 transition-colors text-xs font-bold"
            title="Create Bill (Ctrl+T)"
          >
            <Plus className="h-4 w-4" />
          </Link>

          {/* More options button (...) */}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
            title="Options"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>

          {/* Clock / Recent History */}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors"
            title="Recent Transactions"
          >
            <Clock className="h-3.5 w-3.5" />
          </button>

          {/* Calculator Shortcut */}
          <button
            type="button"
            onClick={() => setShowCalculator((v) => !v)}
            className="hidden sm:flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors"
            title="Calculator"
          >
            <Calculator className="h-3.5 w-3.5" />
          </button>

          {/* History Navigation Arrows */}
          <button
            type="button"
            onClick={() => window.history.back()}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors"
            title="Back"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => window.history.forward()}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors"
            title="Forward"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          {/* Refresh button */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors"
            title="Refresh App"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>

          {/* Offline indicator */}
          {!online && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
              <WifiOff className="h-3 w-3" />
              Offline
            </span>
          )}

          {/* User Profile Avatar */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold border border-emerald-300 hover:ring-2 hover:ring-emerald-400 transition-all ml-1"
              title={user?.name ?? 'User Profile'}
            >
              {initials(user?.name ?? 'SH')}
            </button>

            {showUserMenu && (
              <div
                className="absolute right-0 mt-2 w-48 rounded-xl bg-white p-2 shadow-xl border border-slate-200 z-50 animate-scale-in"
                onClick={() => setShowUserMenu(false)}
              >
                <div className="px-3 py-2 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-900">{user?.name ?? 'Santu Operator'}</p>
                  <p className="text-[10px] font-medium text-slate-500 uppercase">{user?.role ?? 'Admin'}</p>
                </div>
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors mt-1"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ----------------- MAIN LAYOUT: SIDEBAR + CONTENT ----------------- */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Mobile backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Collapsible Dark Navy Sidebar */}
        <aside
          className={cn(
            'flex flex-col bg-[#111827] text-slate-300 transition-all duration-200 select-none z-40 shrink-0 border-r border-slate-800/80',
            'fixed inset-y-14 left-0 lg:static',
            collapsed ? 'w-[60px]' : 'w-[210px]',
            mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          )}
        >
          {/* Top Collapse Toggle Arrow */}
          <div className="flex h-10 items-center justify-end px-3">
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800/90 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="scroll-area flex-1 space-y-1 px-2 py-1 overflow-y-auto">
            {visibleNav.map((item) => {
              const { icon: Icon, label, to, iconColor, hasChevron } = item;
              const isSaleItem = to === '/pos';
              const isPartiesItem = to === '/parties';
              const isWhatsAppItem = label === 'WhatsApp';
              const isUtilitiesItem = label === 'Utilities';
              const inUtilitiesSection =
                location.pathname === '/utilities' ||
                location.pathname === '/invoice-templates' ||
                location.pathname === '/import-items';

              // WhatsApp Item with expandable submenu matching user screenshot
              if (isWhatsAppItem) {
                const inWhatsAppSection = location.pathname === '/whatsapp' || location.pathname.startsWith('/whatsapp/');
                const currentTab = new URLSearchParams(location.search).get('tab') || 'connect';

                const whatsappNavItems = [
                  { label: 'WhatsApp Web', to: '/whatsapp?tab=connect', icon: '/icons/whatsapp/whatsapp.svg', tab: 'connect' },
                  { label: 'Transaction Message', to: '/whatsapp?tab=transaction-message', icon: '/icons/whatsapp/WhatsappTxnSMS.svg', tab: 'transaction-message' },
                ];

                return (
                  <div key="whatsapp" className="space-y-0.5">
                    <div
                      className={cn(
                        'group flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors duration-150',
                        collapsed && 'justify-center px-0',
                        inWhatsAppSection
                          ? 'bg-[#471520] text-white border-l-2 border-[#E03131] shadow-inner'
                          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white',
                      )}
                      title="WhatsApp"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (collapsed) {
                            navigate('/whatsapp');
                          } else {
                            navigate('/whatsapp');
                            setWhatsappExpanded(true);
                          }
                        }}
                        className={cn('flex items-center gap-3 flex-1 text-left', collapsed && 'justify-center')}
                      >
                        <img src="/icons/whatsapp/whatsapp.svg" alt="WA" className="h-4 w-4 shrink-0 object-contain" />
                        {!collapsed && <span className="truncate">WhatsApp</span>}
                      </button>
                      {!collapsed && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setWhatsappExpanded((v) => !v);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors"
                          title={whatsappExpanded ? 'Collapse WhatsApp' : 'Expand WhatsApp'}
                        >
                          {whatsappExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>

                    {/* Expandable WhatsApp Submenu matching user screenshot */}
                    {!collapsed && whatsappExpanded && (
                      <div className="pl-5 pr-2 py-1 space-y-0.5 text-[11px] font-medium text-slate-400 border-l border-slate-800 ml-4 animate-fade-in">
                        {whatsappNavItems.map((sub) => {
                          const isSubActive = location.pathname === '/whatsapp' && currentTab === sub.tab;
                          return (
                            <Link
                              key={sub.label}
                              to={sub.to}
                              className={cn(
                                'flex items-center gap-2 py-1.5 px-2 rounded-md transition-all truncate text-[11px]',
                                isSubActive
                                  ? 'bg-[#471520] text-white font-bold border-l-2 border-[#E03131] shadow-xs'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60',
                              )}
                              title={sub.label}
                            >
                              <img src={sub.icon} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />
                              <span className="truncate">{sub.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              // Utilities Item with expandable submenu matching Image 3 & 4
              if (isUtilitiesItem) {
                const currentSearch = new URLSearchParams(location.search);
                const activeTab = currentSearch.get('tab');

                const utilityNavItems = [
                  { label: 'Shop Profile', to: '/utilities?tab=shop_profile', tab: 'shop_profile' },
                  { label: 'Verify My Data', to: '/utilities?tab=verify_data', tab: 'verify_data' },
                  { label: 'Export Items', to: '/utilities?tab=export_items', tab: 'export_items' },
                  { label: 'Import Items', to: '/import-items', isRoute: '/import-items' },
                  { label: 'Invoice Settings', to: '/invoice-templates', isRoute: '/invoice-templates' },
                ];

                return (
                  <div key="utilities" className="space-y-0.5">
                    <div
                      className={cn(
                        'group flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors duration-150',
                        collapsed && 'justify-center px-0',
                        inUtilitiesSection
                          ? 'bg-[#471520] text-white border-l-2 border-[#E03131] shadow-inner'
                          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white',
                      )}
                      title="Utilities"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (collapsed) {
                            navigate('/utilities');
                          } else {
                            navigate('/utilities');
                            setUtilitiesExpanded(true);
                          }
                        }}
                        className={cn('flex items-center gap-3 flex-1 text-left', collapsed && 'justify-center')}
                      >
                        <Icon className={cn('h-4 w-4 shrink-0 transition-transform duration-150 group-hover:scale-110', iconColor)} />
                        {!collapsed && <span className="truncate">Utilities</span>}
                      </button>
                      {!collapsed && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setUtilitiesExpanded((v) => !v);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors"
                          title={utilitiesExpanded ? 'Collapse Utilities' : 'Expand Utilities'}
                        >
                          {utilitiesExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>

                    {/* Expandable Utilities Submenu matching Image 3 & 4 */}
                    {!collapsed && utilitiesExpanded && (
                      <div className="pl-5 pr-2 py-1 space-y-0.5 text-[11px] font-medium text-slate-400 border-l border-slate-800 ml-4 animate-fade-in">
                        {utilityNavItems.map((sub) => {
                          const isSubActive = sub.isRoute
                            ? location.pathname === sub.isRoute
                            : location.pathname === '/utilities' && activeTab === sub.tab;

                          return (
                            <Link
                              key={sub.to}
                              to={sub.to}
                              className={cn(
                                'block py-1.5 px-2 rounded-md transition-all truncate text-[11px]',
                                isSubActive
                                  ? 'bg-[#471520] text-rose-200 font-bold border-l-2 border-[#E03131] shadow-xs'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60',
                              )}
                              title={sub.label}
                            >
                              {sub.label}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              // Items Item with expandable submenu matching Image 5
              const isItemsItem = label === 'Items';
              if (isItemsItem) {
                const inItemsSection =
                  location.pathname === '/items' ||
                  location.pathname === '/stock' ||
                  location.pathname === '/import-items';
                const itemsNavItems = [
                  { label: 'Stock Summary', to: '/items', icon: '/icons/items/ItemsListIcon.svg' },
                  { label: 'Update Items In Bulk', to: '/import-items', icon: '/icons/items/bulk_update_item_icon.svg' },
                ];

                return (
                  <div key="items" className="space-y-0.5">
                    <div
                      className={cn(
                        'group flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors duration-150',
                        collapsed && 'justify-center px-0',
                        inItemsSection
                          ? 'bg-[#471520] text-white border-l-2 border-[#E03131] shadow-inner'
                          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white',
                      )}
                      title="Items"
                    >
                      <Link
                        to="/items"
                        onClick={() => {
                          if (!collapsed) setItemsExpanded(true);
                        }}
                        className={cn('flex items-center gap-3 flex-1 text-left cursor-pointer', collapsed && 'justify-center')}
                      >
                        <img src="/icons/items/Items.svg" alt="Items" className="h-4 w-4 shrink-0 object-contain" />
                        {!collapsed && <span className="truncate">Items</span>}
                      </Link>
                      {!collapsed && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setItemsExpanded((v) => !v);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors cursor-pointer"
                          title={itemsExpanded ? 'Collapse Items' : 'Expand Items'}
                        >
                          {itemsExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>

                    {!collapsed && itemsExpanded && (
                      <div className="pl-5 pr-2 py-1 space-y-0.5 text-[11px] font-medium text-slate-400 border-l border-slate-800 ml-4 animate-fade-in">
                        {itemsNavItems.map((sub) => {
                          const isSubActive = location.pathname === sub.to;
                          return (
                            <Link
                              key={sub.to}
                              to={sub.to}
                              className={cn(
                                'flex items-center gap-2 py-1.5 px-2 rounded-md transition-all truncate text-[11px] cursor-pointer',
                                isSubActive
                                  ? 'bg-[#471520] text-white font-bold border-l-2 border-[#E03131] shadow-xs'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60',
                              )}
                              title={sub.label}
                            >
                              <img src={sub.icon} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />
                              <span className="truncate">{sub.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              // Sale Item with expandable submenu matching Image 1, 2, 4
              if (isSaleItem) {
                const inSaleSection =
                  location.pathname === '/pos' ||
                  location.pathname === '/sales' ||
                  location.pathname.startsWith('/sales/') ||
                  location.pathname === '/quotations' ||
                  location.pathname.startsWith('/quotations/');

                const saleNavItems = [
                  { label: 'Sale Invoices', to: '/sales', icon: '/icons/sales/blue_invoice_icon.svg' },
                  { label: 'Estimate / Quotation', to: '/quotations', icon: '/icons/sales/estimate.svg' },
                  { label: 'Payment In', to: '/parties?type=Customer', icon: '/icons/sales/bill_icon.svg' },
                  { label: 'Billing (POS)', to: '/pos', icon: '/icons/sales/pos_billing_black.svg' },
                ];

                return (
                  <div key="sale" className="space-y-0.5">
                    <div
                      className={cn(
                        'group flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors duration-150',
                        collapsed && 'justify-center px-0',
                        inSaleSection
                          ? 'bg-[#471520] text-white border-l-2 border-[#E03131] shadow-inner'
                          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white',
                      )}
                      title="Sale"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (collapsed) {
                            navigate('/pos');
                          } else {
                            setSaleExpanded((v) => !v);
                          }
                        }}
                        className={cn('flex items-center gap-3 flex-1 text-left cursor-pointer', collapsed && 'justify-center')}
                      >
                        <img src="/icons/sales/Sale.svg" alt="Sale" className="h-4 w-4 shrink-0 object-contain" />
                        {!collapsed && <span className="truncate">Sale</span>}
                      </button>
                      {!collapsed && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSaleExpanded((v) => !v);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors cursor-pointer"
                        >
                          {saleExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>

                    {!collapsed && saleExpanded && (
                      <div className="pl-5 pr-2 py-1 space-y-0.5 text-[11px] font-medium text-slate-400 border-l border-slate-800 ml-4 animate-fade-in">
                        {saleNavItems.map((sub) => {
                          const isSubActive =
                            sub.to === '/pos'
                              ? location.pathname === '/pos'
                              : sub.to === '/quotations'
                              ? location.pathname.startsWith('/quotations')
                              : sub.to === '/sales'
                              ? location.pathname === '/sales' && !location.search
                              : location.pathname + location.search === sub.to;

                          return (
                            <Link
                              key={sub.label}
                              to={sub.to}
                              className={cn(
                                'flex items-center gap-2 py-1.5 px-2 rounded-md transition-all truncate text-[11px] cursor-pointer',
                                isSubActive
                                  ? 'bg-[#471520] text-white font-bold border-l-2 border-[#E03131] shadow-xs'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60',
                              )}
                              title={sub.label}
                            >
                              <img src={sub.icon} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />
                              <span className="truncate">{sub.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              // Purchase & Expense showed a chevron but had no children, so it
              // promised a menu and opened one page. The expense book did not
              // exist at all.
              if (to === '/purchases') {
                const inPurchaseSection =
                  location.pathname.startsWith('/purchases') || location.pathname.startsWith('/expenses');
                const purchaseNavItems = [
                  { label: 'Purchase Bills', to: '/purchases' },
                  { label: 'Payment Out (Mahajan)', to: '/parties?type=Supplier' },
                  { label: 'Expenses (Kharcha)', to: '/expenses' },
                ];
                const open = purchaseExpanded || inPurchaseSection;

                return (
                  <div key="purchase" className="space-y-0.5">
                    <div
                      className={cn(
                        'group flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors duration-150',
                        collapsed && 'justify-center px-0',
                        inPurchaseSection
                          ? 'bg-[#471520] text-white border-l-2 border-[#E03131] shadow-inner'
                          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white',
                      )}
                      title={label}
                    >
                      <button
                        type="button"
                        onClick={() => (collapsed ? navigate('/purchases') : setPurchaseExpanded((v) => !v))}
                        className={cn('flex items-center gap-3 flex-1 text-left cursor-pointer', collapsed && 'justify-center')}
                      >
                        <Icon className={cn('h-4 w-4 shrink-0', iconColor)} />
                        {!collapsed && <span className="truncate">{label}</span>}
                      </button>
                      {!collapsed && (
                        <button
                          type="button"
                          onClick={() => setPurchaseExpanded((v) => !v)}
                          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors cursor-pointer"
                        >
                          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                    {!collapsed && open && (
                      <div className="pl-5 pr-2 py-1 space-y-0.5 text-[11px] font-medium text-slate-400 border-l border-slate-800 ml-4">
                        {purchaseNavItems.map((sub) => {
                          const active = location.pathname + location.search === sub.to;
                          return (
                            <Link
                              key={sub.label}
                              to={sub.to}
                              className={cn(
                                'flex items-center gap-2 py-1.5 px-2 rounded-md transition-all truncate text-[11px] cursor-pointer',
                                active
                                  ? 'bg-[#471520] text-white font-bold border-l-2 border-[#E03131] shadow-xs'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60',
                              )}
                              title={sub.label}
                            >
                              <span className="truncate">{sub.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              // Standard Nav Links
              return (
                <div key={label} className="space-y-0.5">
                  <NavLink
                    to={to}
                    className={({ isActive }) => {
                      const activeMatch =
                        isActive ||
                        (isSaleItem && (location.pathname === '/pos' || location.pathname.startsWith('/sales'))) ||
                        (isPartiesItem && location.pathname.startsWith('/parties'));

                      return cn(
                        'group relative flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors duration-150',
                        collapsed && 'justify-center px-0',
                        activeMatch
                          ? 'bg-[#471520] text-white border-l-2 border-[#E03131] shadow-inner'
                          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white',
                      );
                    }}
                    title={label}
                  >
                    {({ isActive }) => {
                      const activeMatch =
                        isActive ||
                        (isSaleItem && (location.pathname === '/pos' || location.pathname.startsWith('/sales'))) ||
                        (isPartiesItem && location.pathname.startsWith('/parties'));

                      return (
                        <>
                          <div className="flex items-center gap-3">
                            {isPartiesItem ? (
                              <img src="/icons/parties/Parties.svg" alt="Parties" className="h-4 w-4 shrink-0 object-contain" />
                            ) : (
                              <Icon
                                className={cn(
                                  'h-4 w-4 shrink-0 transition-transform duration-150',
                                  activeMatch ? (isPartiesItem ? 'text-purple-400' : 'text-emerald-400') : iconColor,
                                  'group-hover:scale-110',
                                )}
                              />
                            )}
                            {!collapsed && <span className="truncate">{label}</span>}
                          </div>
                          {!collapsed && hasChevron && (
                            <ChevronRight className="h-3 w-3 text-slate-500 group-hover:text-slate-300" />
                          )}
                        </>
                      );
                    }}
                  </NavLink>
                </div>
              );
            })}
          </nav>

          {/* Bottom user / sign out in expanded mode */}
          {!collapsed && (
            <div className="border-t border-slate-800/80 p-2 text-[11px] text-slate-400 flex items-center justify-between">
              <span className="truncate">Ishuwapur · v2.0</span>
              <button
                onClick={logout}
                className="text-slate-400 hover:text-rose-400 transition-colors p-1"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </aside>

        {/* Main Content Area */}
        <main className="scroll-area flex-1 bg-[#f4f7fb] overflow-y-auto" style={{ paddingBottom: 'var(--safe-bottom)' }}>
          <Outlet />
        </main>
      </div>

      {/* ----------------- POPUP CALCULATOR ----------------- */}
      {showCalculator && (
        <QuickCalculator onClose={() => setShowCalculator(false)} />
      )}

      {/* ----------------- WHATSAPP MODAL ----------------- */}
      {showWhatsAppModal && <WhatsAppModal onClose={() => setShowWhatsAppModal(false)} />}

      {/* ----------------- WHATSAPP CONNECT MODAL ----------------- */}
    </div>
  );
}

function QuickCalculator({ onClose }: { onClose: () => void }): JSX.Element {
  const [calcDisplay, setCalcDisplay] = useState('0');

  const onBtn = (val: string) => {
    if (val === 'C') {
      setCalcDisplay('0');
      return;
    }
    if (val === '=') {
      try {
        // Safe evaluation of simple math
        const sanitized = calcDisplay.replace(/[^0-9+\-*/.]/g, '');
        // eslint-disable-next-line no-eval
        const res = Function(`'use strict'; return (${sanitized})`)();
        setCalcDisplay(String(Number(res).toFixed(2)).replace(/\.00$/, ''));
      } catch {
        setCalcDisplay('Error');
      }
      return;
    }
    if (calcDisplay === '0' || calcDisplay === 'Error') {
      setCalcDisplay(val);
    } else {
      setCalcDisplay(calcDisplay + val);
    }
  };

  return (
    <div className="fixed bottom-12 right-6 z-50 w-64 rounded-2xl bg-white p-4 shadow-2xl border border-slate-200 animate-slide-up">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <Calculator className="h-3.5 w-3.5 text-blue-600" />
          Quick Calc
        </span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-3 rounded-xl bg-slate-900 p-2.5 text-right font-mono text-xl font-bold text-emerald-400 overflow-x-auto">
        {calcDisplay}
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-sm font-semibold">
        {['C', '/', '*', '-'].map((b) => (
          <button
            key={b}
            onClick={() => onBtn(b)}
            className="rounded-lg bg-slate-100 py-2 text-slate-700 hover:bg-slate-200 transition-colors"
          >
            {b}
          </button>
        ))}
        {['7', '8', '9', '+'].map((b) => (
          <button
            key={b}
            onClick={() => onBtn(b)}
            className={cn(
              'rounded-lg py-2 transition-colors',
              b === '+' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-50 text-slate-800 hover:bg-slate-100 border border-slate-200/60',
            )}
          >
            {b}
          </button>
        ))}
        {['4', '5', '6', '='].map((b) => (
          <button
            key={b}
            onClick={() => onBtn(b)}
            className={cn(
              'rounded-lg py-2 transition-colors',
              b === '=' ? 'row-span-2 bg-emerald-600 text-white hover:bg-emerald-700 font-bold' : 'bg-slate-50 text-slate-800 hover:bg-slate-100 border border-slate-200/60',
            )}
          >
            {b}
          </button>
        ))}
        {['1', '2', '3'].map((b) => (
          <button
            key={b}
            onClick={() => onBtn(b)}
            className="rounded-lg bg-slate-50 py-2 text-slate-800 hover:bg-slate-100 border border-slate-200/60 transition-colors"
          >
            {b}
          </button>
        ))}
        {['0', '.'].map((b) => (
          <button
            key={b}
            onClick={() => onBtn(b)}
            className={cn(
              'rounded-lg bg-slate-50 py-2 text-slate-800 hover:bg-slate-100 border border-slate-200/60 transition-colors',
              b === '0' ? 'col-span-2' : '',
            )}
          >
            {b}
          </button>
        ))}
      </div>
    </div>
  );
}



export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 bg-white border-b border-slate-200/80 mb-4 sm:px-6">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-0.5 text-xs font-medium text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

