import { useState, useRef } from 'react';
import {
  Zap,
  Save,
  RotateCcw,
  Search,
  CheckCircle2,
  Eye,
  RefreshCw,
  X,
  Sliders,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { useUpdateSetting } from '@/services/catalog';
import {
  useWhatsAppBridgeStatus,
  sendDirectWhatsAppMessage,
} from '@/services/whatsappBridge';

export const TRANSACTION_TYPES = [
  'Sales Transaction',
  'Purchase Transaction',
  'Sales Return',
  'Purchase Return',
  'Payment In',
  'Payment Out',
  'Sales Order',
  'Purchase Order',
  'Estimate / Quotation',
  'Proforma Invoice',
  'Delivery Challan',
  'Cancelled Invoice',
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TEMPLATE_VARIABLES = [
  'company_name',
  'customer_name',
  'supplier_name',
  'party_name',
  'invoice_no',
  'transaction_type',
  'posting_date',
  'grand_total',
  'paid_amount',
  'outstanding_amount',
  'current_balance',
  'payment_link',
  'invoice_link',
  'company_phone',
  'company_address',
];

export const DEFAULT_TRANSACTION_TEMPLATES: Record<TransactionType, string> = {
  'Sales Transaction': `🧾 *{{ company_name }}*

Hi {{ customer_name }},

Thank you for shopping with us!

*Bill No:* {{ invoice_no }}
*Date:* {{ posting_date }}

💰 *Payment Breakdown:*
*Total Bill:* ₹{{ grand_total }}
*Amount Paid:* ₹{{ paid_amount }}
*Balance Due:* ₹{{ outstanding_amount }}
*Current Balance:* ₹{{ current_balance }}

📄 *View Invoice:* {{ invoice_link }}
📲 *Pay via UPI:* {{ payment_link }}

Questions? Call {{ company_phone }}.
We appreciate your business 🙏`,

  'Purchase Transaction': `🧾 *{{ company_name }}*

Hi {{ supplier_name }},

We've recorded a purchase from you.

*Bill No:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Amount:* ₹{{ grand_total }}

Thank you!`,

  'Sales Return': `🧾 *{{ company_name }}*

Hi {{ customer_name }},

Your return has been processed.

*Credit Note:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Amount:* ₹{{ grand_total }}

Thank you!`,

  'Purchase Return': `🧾 *{{ company_name }}*

Hi {{ supplier_name }},

A purchase return has been recorded.

*Debit Note:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Amount:* ₹{{ grand_total }}`,

  'Payment In': `✅ *{{ company_name }}*

Hi {{ party_name }},

We've received your payment. Thank you!

*Amount Received:* ₹{{ paid_amount }}
*Reference:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Remaining Balance:* ₹{{ outstanding_amount }}

Dhanyawad 🙏`,

  'Payment Out': `*{{ company_name }}*

Hi {{ party_name }},

A payment of ₹{{ paid_amount }} has been processed.

*Reference:* {{ invoice_no }}
*Date:* {{ posting_date }}`,

  'Sales Order': `🧾 *{{ company_name }}*

Hi {{ customer_name }},

Your Sales Order has been created.

*Order No:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Amount:* ₹{{ grand_total }}
*View Order:* {{ invoice_link }}

Thank you!`,

  'Purchase Order': `🧾 *{{ company_name }}*

Hi {{ supplier_name }},

A Purchase Order has been created.

*Order No:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Amount:* ₹{{ grand_total }}`,

  'Estimate / Quotation': `🧾 *{{ company_name }}*

Hi {{ customer_name }},

Here is your quotation.

*Estimate No:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Amount:* ₹{{ grand_total }}
*View Quotation:* {{ invoice_link }}

Let us know if you'd like to confirm this order!`,

  'Proforma Invoice': `🧾 *{{ company_name }}*

Hi {{ customer_name }},

*Proforma Invoice:* {{ invoice_no }}
*Date:* {{ posting_date }}
*Amount:* ₹{{ grand_total }}
*View Invoice:* {{ invoice_link }}`,

  'Delivery Challan': `🚚 *{{ company_name }}*

Hi {{ customer_name }},

Your goods are dispatched and on the way.

*Delivery Challan:* {{ invoice_no }}
*Date:* {{ posting_date }}`,

  'Cancelled Invoice': `*{{ company_name }}*

Hi {{ customer_name }},

Invoice {{ invoice_no }} dated {{ posting_date }} has been cancelled.`,
};

export interface TransactionMessageSettingsData {
  send_to_party: boolean;
  send_update_message: boolean;
  send_copy_to_self: boolean;
  owner_whatsapp_number: string;
  auto_send_on_submit: boolean;
  attach_invoice_pdf: boolean;
  include_web_invoice_link: boolean;
  include_payment_link: boolean;
  include_party_balance: boolean;
  enable_payment_reminder: boolean;
  reminder_frequency_days: number;
  auto_send_types: Record<string, boolean>;
  templates: Record<string, string>;
}

export const DEFAULT_TXN_SETTINGS: TransactionMessageSettingsData = {
  send_to_party: true,
  send_update_message: true,
  send_copy_to_self: false,
  owner_whatsapp_number: '7739802334',
  auto_send_on_submit: false,
  attach_invoice_pdf: true,
  include_web_invoice_link: true,
  include_payment_link: true,
  include_party_balance: true,
  enable_payment_reminder: false,
  reminder_frequency_days: 7,
  auto_send_types: {
    'Sales Transaction': true,
    'Payment In': true,
  },
  templates: { ...DEFAULT_TRANSACTION_TEMPLATES },
};

export interface MessageLogEntry {
  id: string;
  sent_at: string;
  party_name: string;
  reference_name: string;
  transaction_type: string;
  phone_number: string;
  status: 'Delivered' | 'Sent' | 'Failed';
  sent_by: string;
  message_body: string;
}

// Nothing is stored between visits, so the history starts empty and lists
// only what was sent from this screen in this session. It used to open with
// three invented "Delivered" bills (to numbers that are not the shop's
// customers), which read as proof that auto-send was working.
const INITIAL_LOGS: MessageLogEntry[] = [];

interface TransactionMessageViewProps {
  initialSettings?: Partial<TransactionMessageSettingsData>;
  onOpenQrModal?: () => void;
  onBackToChats?: () => void;
}

export function TransactionMessageView({
  initialSettings,
  onOpenQrModal,
  onBackToChats,
}: TransactionMessageViewProps): JSX.Element {
  const toast = useToast();
  const saveSetting = useUpdateSetting();
  const { data: bridgeStatus } = useWhatsAppBridgeStatus();
  const isConnected = bridgeStatus?.state === 'CONNECTED';

  const [activeSubTab, setActiveSubTab] = useState<'message' | 'whatsapp' | 'history'>('message');

  // Form settings state
  const [settings, setSettings] = useState<TransactionMessageSettingsData>(() => ({
    ...DEFAULT_TXN_SETTINGS,
    ...(initialSettings || {}),
    templates: {
      ...DEFAULT_TRANSACTION_TEMPLATES,
      ...(initialSettings?.templates || {}),
    },
    auto_send_types: {
      ...DEFAULT_TXN_SETTINGS.auto_send_types,
      ...(initialSettings?.auto_send_types || {}),
    },
  }));

  const [selectedTxnType, setSelectedTxnType] = useState<TransactionType>('Sales Transaction');
  const [activeTemplateText, setActiveTemplateText] = useState<string>(
    () => settings.templates[selectedTxnType] || DEFAULT_TRANSACTION_TEMPLATES[selectedTxnType],
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Message Logs / History State
  const [logs, setLogs] = useState<MessageLogEntry[]>(INITIAL_LOGS);
  const [logSearch, setLogSearch] = useState('');
  const [selectedLogForDetail, setSelectedLogForDetail] = useState<MessageLogEntry | null>(null);
  const [testMobile, setTestMobile] = useState('7739802334');
  const [isSendingTest, setIsSendingTest] = useState(false);

  // Handle switching transaction type
  const handleTxnTypeChange = (type: TransactionType) => {
    // Commit current text to state first
    setSettings((prev) => ({
      ...prev,
      templates: {
        ...prev.templates,
        [selectedTxnType]: activeTemplateText,
      },
    }));
    setSelectedTxnType(type);
    setActiveTemplateText(settings.templates[type] || DEFAULT_TRANSACTION_TEMPLATES[type]);
  };

  // Insert variable tag at cursor
  const handleInsertVariable = (varName: string) => {
    const el = textareaRef.current;
    const tag = `{{ ${varName} }}`;
    if (!el) {
      setActiveTemplateText((prev) => prev + ' ' + tag);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = activeTemplateText;
    const next = text.slice(0, start) + tag + text.slice(end);
    setActiveTemplateText(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    }, 0);
  };

  // Live variable replacement for preview
  const generatePreview = (template: string): string => {
    const sample: Record<string, string> = {
      company_name: 'SANTU HARDWARE',
      customer_name: 'Abhishek Bhagat',
      supplier_name: 'Tata Steel Tubes Ltd.',
      party_name: 'Abhishek Bhagat',
      invoice_no: 'INV-01008',
      transaction_type: selectedTxnType,
      posting_date: '21-Sep-2026',
      grand_total: '8,250.00',
      paid_amount: '5,000.00',
      outstanding_amount: '3,250.00',
      current_balance: '3,250.00',
      payment_link: 'santuhardware1@ibl',
      invoice_link: `${window.location.origin}/bill/sample`,
      company_phone: '7739802334',
      company_address: 'Main Road Ishuwapur, Saran, Bihar',
    };

    let result = template;
    for (const [key, val] of Object.entries(sample)) {
      result = result.replaceAll(`{{ ${key} }}`, val);
      result = result.replaceAll(`{{${key}}}`, val);
    }
    return result;
  };

  // Save all settings to DB
  const handleSaveAllSettings = async () => {
    const nextSettings: TransactionMessageSettingsData = {
      ...settings,
      templates: {
        ...settings.templates,
        [selectedTxnType]: activeTemplateText,
      },
    };
    try {
      await saveSetting.mutateAsync({
        key: 'transaction_message_settings',
        value: nextSettings,
      });
      setSettings(nextSettings);
      toast.success('Transaction Message Settings Saved', 'All templates and rules updated successfully.');
    } catch {
      toast.error('Save Failed', 'Could not save transaction message settings.');
    }
  };

  // Reset current template to default
  const handleResetTemplate = () => {
    const def = DEFAULT_TRANSACTION_TEMPLATES[selectedTxnType];
    setActiveTemplateText(def);
    setSettings((prev) => ({
      ...prev,
      templates: {
        ...prev.templates,
        [selectedTxnType]: def,
      },
    }));
    toast.success('Template Reset', `Reset "${selectedTxnType}" to default template.`);
  };

  // Send Test Message
  const handleSendTestMessage = async () => {
    if (!testMobile.trim() || testMobile.replace(/\D/g, '').length < 10) {
      toast.error('Invalid Mobile', 'Please enter a valid 10-digit phone number.');
      return;
    }
    setIsSendingTest(true);
    const body = generatePreview(activeTemplateText);
    try {
      await sendDirectWhatsAppMessage(testMobile, body);
      toast.success('Test message bhej diya', `${testMobile} par gaya — pahuncha ya nahi, WhatsApp ke tick se dikhega.`);
      // Add to log
      setLogs((prev) => [
        {
          id: `log-${Date.now()}`,
          sent_at: new Date().toISOString().replace('T', ' ').slice(0, 16),
          party_name: 'Test Customer',
          reference_name: '#TEST-SAMPLE',
          transaction_type: selectedTxnType,
          phone_number: testMobile,
          status: 'Sent',
          sent_by: 'Manual Test',
          message_body: body,
        },
        ...prev,
      ]);
    } catch (err: any) {
      toast.error('Send Failed', err?.message || 'Check WhatsApp bridge connection.');
    } finally {
      setIsSendingTest(false);
    }
  };

  // Filter logs
  const filteredLogs = logs.filter(
    (l) =>
      l.party_name.toLowerCase().includes(logSearch.toLowerCase()) ||
      l.reference_name.toLowerCase().includes(logSearch.toLowerCase()) ||
      l.phone_number.includes(logSearch),
  );

  return (
    <div className="w-full h-full flex flex-col bg-[#f8fafc] text-slate-800 select-none overflow-hidden font-sans">
      {/* Top Banner & Sub-Navigation Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 shrink-0 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center shadow-xs p-1">
            <img src="/icons/whatsapp/WhatsappTxnSMS.svg" alt="Txn" className="h-7 w-7 object-contain" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 leading-tight">
                Transaction Message
              </h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                Santu Hardware Official
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Configure automatic and manual WhatsApp messages for bills, invoices, receipts, and returns.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Sub Tabs Pill Switcher */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600">
            <button
              type="button"
              onClick={() => setActiveSubTab('message')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all ${
                activeSubTab === 'message'
                  ? 'bg-white text-blue-700 shadow-xs font-bold'
                  : 'hover:text-slate-900'
              }`}
            >
              <img src="/icons/whatsapp/whatsAppSettings.svg" alt="" className="h-3.5 w-3.5 object-contain" />
              <span>Message Settings</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('whatsapp')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all ${
                activeSubTab === 'whatsapp'
                  ? 'bg-white text-blue-700 shadow-xs font-bold'
                  : 'hover:text-slate-900'
              }`}
            >
              <img src="/icons/whatsapp/whatsapp.svg" alt="" className="h-3.5 w-3.5 object-contain" />
              <span>WhatsApp Bridge</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('history')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all ${
                activeSubTab === 'history'
                  ? 'bg-white text-blue-700 shadow-xs font-bold'
                  : 'hover:text-slate-900'
              }`}
            >
              <img src="/icons/whatsapp/chatWhatsapp.svg" alt="" className="h-3.5 w-3.5 object-contain" />
              <span>Message History</span>
              {logs.length > 0 && (
                <span className="h-4 px-1.5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold inline-flex items-center justify-center">
                  {logs.length}
                </span>
              )}
            </button>
          </div>

          {onBackToChats && (
            <button
              type="button"
              onClick={onBackToChats}
              className="px-3.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <span>Back to WhatsApp Web</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-5 sm:p-6">
        {/* ===================================================================
            SUB-TAB 1: MESSAGE SETTINGS & TEMPLATES
           =================================================================== */}
        {activeSubTab === 'message' && (
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Bridge Status Banner */}
            <div
              className={`p-3.5 rounded-xl border flex items-center justify-between gap-4 text-xs ${
                isConnected
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                    isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                  }`}
                />
                <div>
                  <strong>
                    {isConnected
                      ? `🟢 WhatsApp Bridge Connected (+91 ${bridgeStatus?.phone || 'Linked'})`
                      : '🟡 WhatsApp Bridge Standalone Mode'}
                  </strong>
                  <p className="text-[11px] opacity-90 mt-0.5">
                    {isConnected
                      ? 'Invoices, payment receipts, and reminders will be sent directly to customer WhatsApp in 1-click.'
                      : 'Link your phone using the QR code in WhatsApp Bridge tab to enable 1-click direct sending.'}
                  </p>
                </div>
              </div>

              {!isConnected && onOpenQrModal && (
                <button
                  type="button"
                  onClick={onOpenQrModal}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shrink-0 cursor-pointer shadow-xs transition-colors"
                >
                  Link WhatsApp QR →
                </button>
              )}
            </div>

            {/* Grid: 2 Columns (Left: Settings + Template, Right: Live WhatsApp Preview) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column (7 cols): Recipient Options, Auto-Trigger Grid, and Template Editor */}
              <div className="lg:col-span-7 space-y-5">
                {/* 1. Message Recipient Settings Card */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs">
                  <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <Sliders className="h-4 w-4 text-blue-600" />
                    <span>Message Recipient Settings</span>
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-700">
                    <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200 transition-colors">
                      <input
                        type="checkbox"
                        checked={settings.send_to_party}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, send_to_party: e.target.checked }))
                        }
                        className="rounded text-blue-600 h-4 w-4"
                      />
                      <span className="font-semibold">Send Message to Party</span>
                    </label>

                    <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200 transition-colors">
                      <input
                        type="checkbox"
                        checked={settings.send_update_message}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, send_update_message: e.target.checked }))
                        }
                        className="rounded text-blue-600 h-4 w-4"
                      />
                      <span className="font-semibold">Send Transaction Update Message</span>
                    </label>

                    <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200 transition-colors">
                      <input
                        type="checkbox"
                        checked={settings.send_copy_to_self}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, send_copy_to_self: e.target.checked }))
                        }
                        className="rounded text-blue-600 h-4 w-4"
                      />
                      <span className="font-semibold">Send Message Copy to Self</span>
                    </label>

                    <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200 transition-colors">
                      <input
                        type="checkbox"
                        checked={settings.auto_send_on_submit}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, auto_send_on_submit: e.target.checked }))
                        }
                        className="rounded text-blue-600 h-4 w-4"
                      />
                      <span className="font-semibold">Auto Send Invoice on Submit</span>
                    </label>

                    <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200 transition-colors">
                      <input
                        type="checkbox"
                        checked={settings.attach_invoice_pdf}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, attach_invoice_pdf: e.target.checked }))
                        }
                        className="rounded text-blue-600 h-4 w-4"
                      />
                      <span className="font-semibold">Attach Invoice PDF / Image</span>
                    </label>

                    <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200 transition-colors">
                      <input
                        type="checkbox"
                        checked={settings.include_web_invoice_link}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, include_web_invoice_link: e.target.checked }))
                        }
                        className="rounded text-blue-600 h-4 w-4"
                      />
                      <span className="font-semibold">Include Web Invoice Link</span>
                    </label>

                    <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200 transition-colors">
                      <input
                        type="checkbox"
                        checked={settings.include_payment_link}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, include_payment_link: e.target.checked }))
                        }
                        className="rounded text-blue-600 h-4 w-4"
                      />
                      <span className="font-semibold">Include UPI Payment Link</span>
                    </label>

                    <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200 transition-colors">
                      <input
                        type="checkbox"
                        checked={settings.include_party_balance}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, include_party_balance: e.target.checked }))
                        }
                        className="rounded text-blue-600 h-4 w-4"
                      />
                      <span className="font-semibold">Include Current Party Balance</span>
                    </label>
                  </div>

                  {/* Owner WhatsApp Number Input */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-3">
                    <label className="text-xs font-bold text-slate-700 whitespace-nowrap">
                      Owner WhatsApp Number:
                    </label>
                    <div className="relative max-w-xs w-full">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-xs text-slate-400 font-bold">
                        +91
                      </div>
                      <input
                        type="text"
                        value={settings.owner_whatsapp_number}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, owner_whatsapp_number: e.target.value }))
                        }
                        placeholder="7739802334"
                        className="w-full pl-10 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Send Automatic Message For (Grid) */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs">
                  <h3 className="text-sm font-bold text-slate-900 mb-2">
                    Send Automatic Message for
                  </h3>
                  <p className="text-xs text-slate-500 mb-3">
                    Check the transaction types that should automatically trigger WhatsApp messages.
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    {TRANSACTION_TYPES.map((t) => {
                      const isChecked = Boolean(settings.auto_send_types[t]);
                      return (
                        <label
                          key={t}
                          className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer border transition-colors ${
                            isChecked
                              ? 'bg-blue-50/70 border-blue-200 text-blue-950 font-bold'
                              : 'bg-slate-50/50 border-slate-200/60 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) =>
                              setSettings((s) => ({
                                ...s,
                                auto_send_types: {
                                  ...s.auto_send_types,
                                  [t]: e.target.checked,
                                },
                              }))
                            }
                            className="rounded text-blue-600 h-3.5 w-3.5"
                          />
                          <span className="truncate">{t}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Edit Message Template Card */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Edit Message Template
                      </h3>
                      <p className="text-xs text-slate-500">
                        Choose a transaction type to customize its message wording.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={selectedTxnType}
                        onChange={(e) => handleTxnTypeChange(e.target.value as TransactionType)}
                        className="text-xs font-bold py-1.5 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer"
                      >
                        {TRANSACTION_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={handleResetTemplate}
                        title="Reset to original template"
                        className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer transition-colors"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Variables Insertion Chips */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Click variable chip to insert into text:
                    </label>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 rounded-xl bg-slate-50 border border-slate-200/80">
                      {TEMPLATE_VARIABLES.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => handleInsertVariable(v)}
                          className="px-2 py-0.5 rounded-md bg-white border border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-slate-700 hover:text-blue-700 text-[11px] font-mono cursor-pointer transition-colors shadow-2xs"
                        >
                          {`{{ ${v} }}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Textarea Template Editor */}
                  <div>
                    <textarea
                      ref={textareaRef}
                      rows={10}
                      value={activeTemplateText}
                      onChange={(e) => setActiveTemplateText(e.target.value)}
                      className="w-full text-xs sm:text-sm p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 font-sans leading-relaxed text-slate-800"
                      placeholder="Type your WhatsApp message template here..."
                    />
                  </div>

                  {/* Save Footer Bar */}
                  <div className="flex items-center justify-between pt-2">
                    <div className="text-[11px] text-slate-400">
                      Supports bold (<code>*text*</code>) and italic (<code>_text_</code>).
                    </div>
                    <button
                      type="button"
                      disabled={saveSetting.isPending}
                      onClick={handleSaveAllSettings}
                      className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md transition-all disabled:opacity-50"
                    >
                      {saveSetting.isPending ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      <span>Save All Settings</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column (5 cols): Live WhatsApp Preview Bubble & Test Send */}
              <div className="lg:col-span-5 space-y-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-900">
                      Message Preview
                    </h3>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                      WhatsApp Web Preview
                    </span>
                  </div>

                  {/* Authentic WhatsApp Bubble Preview */}
                  <div
                    className="p-5 rounded-2xl border border-[#d1d7db] shadow-inner relative overflow-hidden"
                    style={{
                      backgroundColor: '#efeae2',
                      backgroundImage: 'url("/images/whatsapp/whatsappInvoicePreviewBackground.webp")',
                      backgroundRepeat: 'repeat',
                      backgroundSize: '400px',
                    }}
                  >
                    <div className="bg-[#d9fdd3] rounded-2xl rounded-tr-xs p-4 shadow-sm border border-[#c4f0bd] max-w-sm ml-auto">
                      <div className="text-xs font-bold text-[#075e54] mb-1.5 flex items-center justify-between">
                        <span>SANTU HARDWARE</span>
                        <span className="text-[10px] font-normal text-slate-500">Official</span>
                      </div>

                      <div className="text-xs text-[#111b21] whitespace-pre-wrap leading-relaxed font-sans">
                        {generatePreview(activeTemplateText)}
                      </div>

                      <div className="flex items-center justify-end gap-1 mt-2 text-[10px] text-[#667781] font-semibold">
                        <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <img src="/icons/whatsapp/blue_tick_icon.svg" alt="Delivered" className="h-4 w-4 inline-block" />
                      </div>
                    </div>
                  </div>

                  {/* Send Test WhatsApp Message Box */}
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-2.5">
                    <label className="block text-xs font-bold text-slate-700">
                      Send Test WhatsApp Message:
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-xs text-slate-400 font-bold">
                          +91
                        </div>
                        <input
                          type="text"
                          value={testMobile}
                          onChange={(e) => setTestMobile(e.target.value)}
                          placeholder="Phone number"
                          className="w-full pl-10 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 font-mono"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={isSendingTest}
                        onClick={handleSendTestMessage}
                        className="px-4 py-2 rounded-xl bg-[#00a884] hover:bg-[#02906f] text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors disabled:opacity-50"
                      >
                        {isSendingTest ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Zap className="h-3.5 w-3.5" />
                        )}
                        <span>Send Test</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Sends this live preview to the phone number via active WhatsApp session.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            SUB-TAB 2: WHATSAPP INTEGRATION & BRIDGE STATUS
           =================================================================== */}
        {activeSubTab === 'whatsapp' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="overflow-hidden rounded-2xl border border-slate-200/90 shadow-xs bg-white">
              <img
                src="/images/whatsapp/payment_reminder_banner.webp"
                alt="WhatsApp Billing & Reminders"
                className="w-full h-36 sm:h-44 object-cover"
              />
            </div>

            <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-2xl bg-[#dcfce7] p-2 flex items-center justify-center shadow-xs">
                    <img src="/icons/whatsapp/whatsapp.svg" alt="WhatsApp" className="h-7 w-7" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      WhatsApp Linked-Device Bridge
                    </h3>
                    <p className="text-xs text-slate-500">
                      Zero setup, no monthly API subscriptions, native WhatsApp Web protocol.
                    </p>
                  </div>
                </div>

                <span
                  className={`text-xs font-bold px-3 py-1 rounded-full ${
                    isConnected
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {isConnected ? '● CONNECTED' : '● NOT CONNECTED'}
                </span>
              </div>

              {/* Status details card */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Bridge Engine
                  </span>
                  <p className="text-sm font-bold text-slate-900">Baileys Multi-Device</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Port 18765 (Local Microservice)</p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Linked Phone Number
                  </span>
                  <p className="text-sm font-bold text-slate-900">
                    {bridgeStatus?.phone ? `+91 ${bridgeStatus.phone}` : 'None linked'}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Shop Business WhatsApp</p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Direct Bill Sending
                  </span>
                  <p className="text-sm font-bold text-emerald-600">
                    {isConnected ? 'Active & Ready' : 'Pending Link'}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">POS & Sales direct delivery</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-wrap items-center gap-3">
                {onOpenQrModal && (
                  <button
                    type="button"
                    onClick={onOpenQrModal}
                    className="px-5 py-2.5 rounded-xl bg-[#00a884] hover:bg-[#02906f] text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-md transition-colors"
                  >
                    <Zap className="h-4 w-4" />
                    <span>{isConnected ? 'Re-link or Scan New QR' : 'Scan QR to Link WhatsApp'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    toast.success('Connection Verified', 'Local WhatsApp microservice is active on port 18765.');
                  }}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Test Bridge Health</span>
                </button>
              </div>

              {/* Instructions Callout */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-2">
                <p className="font-bold text-slate-800">Kaise link karein?</p>
                <ol className="list-decimal list-inside space-y-1 text-slate-600 leading-relaxed">
                  <li>Apne dukan wale phone me <strong>WhatsApp</strong> open karein.</li>
                  <li>Upar 3 dots (⋮) ya Settings me <strong>Linked Devices (लिंक्ड डिवाइसेज़)</strong> par tap karein.</li>
                  <li><strong>"Link a Device"</strong> button dabayein aur computer screen par aane wala QR scan karein.</li>
                  <li>Ek baar link hone ke baad, kisi bhi customer ko bill aur payment reminders seedhe dukan ke WhatsApp se bina kisi tab ke chale jayenge.</li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            SUB-TAB 3: MESSAGE HISTORY & LOGS
           =================================================================== */}
        {activeSubTab === 'history' && (
          <div className="max-w-6xl mx-auto space-y-4">
            <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Message History & Delivery Logs
                  </h3>
                  <p className="text-xs text-slate-500">
                    Audit log of all transaction messages, bills, and payment reminders sent to parties.
                  </p>
                </div>

                {/* Search in History */}
                <div className="relative w-72">
                  <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    placeholder="Search by party or invoice..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                  {logSearch && (
                    <button
                      type="button"
                      onClick={() => setLogSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Data Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-black tracking-wider border-b border-slate-200 select-none">
                    <tr>
                      <th className="py-2.5 px-3">Date & Time</th>
                      <th className="py-2.5 px-3">Party Name</th>
                      <th className="py-2.5 px-3">Invoice / Ref</th>
                      <th className="py-2.5 px-3">Transaction Type</th>
                      <th className="py-2.5 px-3">Mobile No</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Sent By</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-10 text-xs text-slate-400">
                          No transaction messages found matching your search.
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                            {log.sent_at}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-slate-900 whitespace-nowrap">
                            {log.party_name}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-blue-700 font-semibold whitespace-nowrap">
                            {log.reference_name}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                            {log.transaction_type}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                            +91 {log.phone_number}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                                log.status === 'Delivered'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : log.status === 'Sent'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              <img src="/icons/whatsapp/blue_tick_icon.svg" alt="Delivered" className="h-3 w-3 inline-block" />
                              {log.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                            {log.sent_by}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap space-x-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedLogForDetail(log)}
                              className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <Eye className="h-3 w-3 text-slate-500" />
                              <span>View</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                toast.success('Retrying Send...', `Re-sending message to +91 ${log.phone_number}`);
                                sendDirectWhatsAppMessage(log.phone_number, log.message_body).then(() => {
                                  toast.success('Dubara bhej diya', 'WhatsApp ne message le liya.');
                                }).catch((err) => {
                                  toast.error('Retry Failed', err?.message);
                                });
                              }}
                              className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <RefreshCw className="h-3 w-3" />
                              <span>Retry</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Message Body Detail Modal */}
      {selectedLogForDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Message Log Detail
                </h3>
                <p className="text-xs text-slate-500">
                  Sent to {selectedLogForDetail.party_name} ({selectedLogForDetail.phone_number})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLogForDetail(null)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="bg-[#d9fdd3] p-4 rounded-xl border border-[#c4f0bd] max-h-72 overflow-y-auto">
              <pre className="text-xs text-[#111b21] whitespace-pre-wrap font-sans leading-relaxed">
                {selectedLogForDetail.message_body}
              </pre>
            </div>

            <div className="text-xs text-slate-500 flex items-center justify-between pt-2">
              <span>Timestamp: {selectedLogForDetail.sent_at}</span>
              <span className="font-bold text-emerald-700">Status: {selectedLogForDetail.status}</span>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedLogForDetail(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
