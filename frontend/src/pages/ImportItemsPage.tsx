import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Barcode,
  FileSpreadsheet,
  FileText,
  Library,
  Check,
  Upload,
  Download,
  Plus,
  Trash2,
  ArrowRight,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  Package,
  ArrowLeft,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { parseSpreadsheet } from '@/features/items/importParser';
import { ApiError, api } from '@/lib/api';
import type { Item, ItemVariant } from '@/types';

type ImportMethod = 'barcode' | 'excel' | 'ocr' | 'library';

interface ImportItemRow {
  id: string;
  item_code: string;
  name: string;
  category: string;
  brand: string;
  stock_unit: string;
  purchase_price: number;
  selling_price: number;
  mrp: number;
  min_stock: number;
  stock?: number;
  barcode: string;
  hsn_code: string;
  tax_rate: number;
  status?: 'ready' | 'invalid';
  statusMessage?: string;
}

interface MasterPackageItem {
  name: string;
  item_code: string;
  category: string;
  brand: string;
  stock_unit: string;
  purchase_price: number;
  selling_price: number;
  mrp: number;
  min_stock: number;
  barcode: string;
  hsn_code: string;
  tax_rate: number;
}

interface MasterPackage {
  id: string;
  title: string;
  brand: string;
  category: string;
  description: string;
  badge: string;
  color: string;
  items: MasterPackageItem[];
}

const SAMPLE_CSV_ITEMS: ImportItemRow[] = [
  {
    id: 'row-1',
    item_code: 'AP-APEX-20L',
    name: 'Asian Paints Apex Ultima White 20L',
    category: 'Paint',
    brand: 'Asian Paints',
    stock_unit: 'LITRE',
    purchase_price: 3400,
    selling_price: 3850,
    mrp: 4250,
    min_stock: 4,
    barcode: '8901030112233',
    hsn_code: '3208',
    tax_rate: 18,
    status: 'ready',
  },
  {
    id: 'row-2',
    item_code: 'SUP-PVC-1IN-10FT',
    name: 'Supreme PVC Heavy Pressure Pipe 1" (10ft)',
    category: 'Plumbing',
    brand: 'Astral',
    stock_unit: 'PCS',
    purchase_price: 160,
    selling_price: 195,
    mrp: 220,
    min_stock: 20,
    barcode: '8901234500042',
    hsn_code: '3917',
    tax_rate: 18,
    status: 'ready',
  },
  {
    id: 'row-3',
    item_code: 'HAV-WIRE-2.5MM',
    name: 'Havells LifeLine 2.5 sq mm FR Wire (90m)',
    category: 'Electrical',
    brand: 'Havells',
    stock_unit: 'BOX',
    purchase_price: 2450,
    selling_price: 2850,
    mrp: 3200,
    min_stock: 6,
    barcode: '8901456789012',
    hsn_code: '8544',
    tax_rate: 18,
    status: 'ready',
  },
  {
    id: 'row-4',
    item_code: 'GOD-MORTISE-6L',
    name: 'Godrej Nav-Tal 6-Lever Brass Mortise Lock',
    category: 'Hardware',
    brand: 'Generic',
    stock_unit: 'PCS',
    purchase_price: 420,
    selling_price: 520,
    mrp: 580,
    min_stock: 5,
    barcode: '8901876543210',
    hsn_code: '8301',
    tax_rate: 18,
    status: 'ready',
  },
  {
    id: 'row-5',
    item_code: 'BOS-BLADE-5IN',
    name: 'Bosch Standard Diamond Cutting Blade 5"',
    category: 'Tools',
    brand: 'Bosch',
    stock_unit: 'PCS',
    purchase_price: 175,
    selling_price: 225,
    mrp: 260,
    min_stock: 12,
    barcode: '8901234567890',
    hsn_code: '6804',
    tax_rate: 18,
    status: 'ready',
  },
];

const MASTER_PACKAGES: MasterPackage[] = [
  {
    id: 'pkg-paints',
    title: 'Asian Paints & Primers Essential Pack',
    brand: 'Asian Paints',
    category: 'Paint',
    description: 'High-margin top seller emulsion, exterior weathercoat, and primers for home construction.',
    badge: 'Best Seller',
    color: 'border-purple-200 bg-purple-50/50 text-purple-700',
    items: [
      {
        name: 'Asian Paints Apex WeatherProof 20L',
        item_code: 'AP-APEX-20L',
        category: 'Paint',
        brand: 'Asian Paints',
        stock_unit: 'LITRE',
        purchase_price: 3400,
        selling_price: 3850,
        mrp: 4250,
        min_stock: 4,
        barcode: '8901030112233',
        hsn_code: '3208',
        tax_rate: 18,
      },
      {
        name: 'Asian Paints Tractor Emulsion 10L White',
        item_code: 'AP-TRAC-10L',
        category: 'Paint',
        brand: 'Asian Paints',
        stock_unit: 'LITRE',
        purchase_price: 1450,
        selling_price: 1680,
        mrp: 1850,
        min_stock: 6,
        barcode: '8901030112240',
        hsn_code: '3208',
        tax_rate: 18,
      },
      {
        name: 'TruCare Exterior Wall Primer 4L',
        item_code: 'AP-PRIM-4L',
        category: 'Paint',
        brand: 'Asian Paints',
        stock_unit: 'LITRE',
        purchase_price: 520,
        selling_price: 620,
        mrp: 700,
        min_stock: 8,
        barcode: '8901030112257',
        hsn_code: '3208',
        tax_rate: 18,
      },
      {
        name: 'Apcolite Premium Gloss Enamel 1L',
        item_code: 'AP-ENAM-1L',
        category: 'Paint',
        brand: 'Asian Paints',
        stock_unit: 'LITRE',
        purchase_price: 280,
        selling_price: 340,
        mrp: 380,
        min_stock: 12,
        barcode: '8901030112264',
        hsn_code: '3208',
        tax_rate: 18,
      },
    ],
  },
  {
    id: 'pkg-plumbing',
    title: 'Supreme & Astral PVC Plumbing Essentials',
    brand: 'Astral',
    category: 'Plumbing',
    description: '1" high pressure PVC pipes, 90-degree elbows, brass tees, and solvent cement.',
    badge: 'High Turn',
    color: 'border-blue-200 bg-blue-50/50 text-blue-700',
    items: [
      {
        name: 'Supreme PVC Heavy Pressure Pipe 1" (10ft)',
        item_code: 'SUP-PVC-1IN-10FT',
        category: 'Plumbing',
        brand: 'Astral',
        stock_unit: 'PCS',
        purchase_price: 160,
        selling_price: 195,
        mrp: 220,
        min_stock: 20,
        barcode: '8901234500042',
        hsn_code: '3917',
        tax_rate: 18,
      },
      {
        name: 'Supreme PVC Elbow 90 Degree 1"',
        item_code: 'SUP-ELBOW-1IN',
        category: 'Plumbing',
        brand: 'Astral',
        stock_unit: 'PCS',
        purchase_price: 18,
        selling_price: 25,
        mrp: 30,
        min_stock: 50,
        barcode: '8901234500059',
        hsn_code: '3917',
        tax_rate: 18,
      },
      {
        name: 'Supreme PVC Brass Female Threaded Tee 1"',
        item_code: 'SUP-BRASS-TEE-1IN',
        category: 'Plumbing',
        brand: 'Astral',
        stock_unit: 'PCS',
        purchase_price: 65,
        selling_price: 85,
        mrp: 100,
        min_stock: 15,
        barcode: '8901234500066',
        hsn_code: '3917',
        tax_rate: 18,
      },
      {
        name: 'Astral Solv-Weld Heavy Duty PVC Solvent 100ml',
        item_code: 'AST-SOLV-100ML',
        category: 'Plumbing',
        brand: 'Astral',
        stock_unit: 'PCS',
        purchase_price: 45,
        selling_price: 60,
        mrp: 75,
        min_stock: 25,
        barcode: '8901234500073',
        hsn_code: '3506',
        tax_rate: 18,
      },
    ],
  },
  {
    id: 'pkg-electrical',
    title: 'Havells & Anchor Electrical Wiring Kit',
    brand: 'Havells',
    category: 'Electrical',
    description: 'Modular switches, 3-pin universal sockets, MCBs, and 2.5 sq mm copper wire coils.',
    badge: 'Standard Kit',
    color: 'border-amber-200 bg-amber-50/50 text-amber-700',
    items: [
      {
        name: 'Anchor Roma 16A 1-Way Modular Switch',
        item_code: 'ANC-SW-16A',
        category: 'Electrical',
        brand: 'Havells',
        stock_unit: 'PCS',
        purchase_price: 48,
        selling_price: 65,
        mrp: 80,
        min_stock: 30,
        barcode: '8901456789029',
        hsn_code: '8536',
        tax_rate: 18,
      },
      {
        name: 'Anchor Roma 16A 3-Pin Universal Socket',
        item_code: 'ANC-SKT-16A',
        category: 'Electrical',
        brand: 'Havells',
        stock_unit: 'PCS',
        purchase_price: 95,
        selling_price: 130,
        mrp: 155,
        min_stock: 25,
        barcode: '8901456789036',
        hsn_code: '8536',
        tax_rate: 18,
      },
      {
        name: 'Havells LifeLine 2.5 sq mm FR Wire (90m)',
        item_code: 'HAV-WIRE-2.5MM',
        category: 'Electrical',
        brand: 'Havells',
        stock_unit: 'BOX',
        purchase_price: 2450,
        selling_price: 2850,
        mrp: 3200,
        min_stock: 6,
        barcode: '8901456789012',
        hsn_code: '8544',
        tax_rate: 18,
      },
      {
        name: 'Havells 32A Double Pole C-Curve MCB',
        item_code: 'HAV-MCB-32A-DP',
        category: 'Electrical',
        brand: 'Havells',
        stock_unit: 'PCS',
        purchase_price: 310,
        selling_price: 390,
        mrp: 460,
        min_stock: 8,
        barcode: '8901456789043',
        hsn_code: '8536',
        tax_rate: 18,
      },
    ],
  },
  {
    id: 'pkg-hardware',
    title: 'Hardware, Fasteners & Power Tool Blades',
    brand: 'Generic',
    category: 'Hardware',
    description: 'Mortise door locks, SS butt hinges, drywall screws box, and Bosch diamond blades.',
    badge: 'Counter Essentials',
    color: 'border-emerald-200 bg-emerald-50/50 text-emerald-700',
    items: [
      {
        name: 'Godrej Nav-Tal 6-Lever Brass Mortise Lock',
        item_code: 'GOD-MORTISE-6L',
        category: 'Hardware',
        brand: 'Generic',
        stock_unit: 'PCS',
        purchase_price: 420,
        selling_price: 520,
        mrp: 580,
        min_stock: 5,
        barcode: '8901876543210',
        hsn_code: '8301',
        tax_rate: 18,
      },
      {
        name: 'Stainless Steel Butt Hinges 4" Heavy [Pair]',
        item_code: 'SS-HINGE-4IN-PR',
        category: 'Hardware',
        brand: 'Generic',
        stock_unit: 'SET',
        purchase_price: 75,
        selling_price: 110,
        mrp: 130,
        min_stock: 40,
        barcode: '8901876543227',
        hsn_code: '8302',
        tax_rate: 18,
      },
      {
        name: 'Drywall Black Gypsum Screws 25mm [Box 500 pcs]',
        item_code: 'SCRW-DRYWALL-25MM',
        category: 'Hardware',
        brand: 'Generic',
        stock_unit: 'BOX',
        purchase_price: 130,
        selling_price: 180,
        mrp: 220,
        min_stock: 15,
        barcode: '8901876543234',
        hsn_code: '7318',
        tax_rate: 18,
      },
      {
        name: 'Bosch Standard Diamond Cutting Blade 5"',
        item_code: 'BOS-BLADE-5IN',
        category: 'Tools',
        brand: 'Bosch',
        stock_unit: 'PCS',
        purchase_price: 175,
        selling_price: 225,
        mrp: 260,
        min_stock: 12,
        barcode: '8901234567890',
        hsn_code: '6804',
        tax_rate: 18,
      },
    ],
  },
];

const KNOWN_BARCODE_LOOKUP: Record<string, Partial<ImportItemRow>> = {
  '8901084012345': {
    name: 'Fevicol SH Synthetic Resin Adhesive 1 KG',
    item_code: 'FEV-SH-1KG',
    category: 'Hardware',
    brand: 'Generic',
    stock_unit: 'KG',
    purchase_price: 215,
    selling_price: 260,
    mrp: 295,
    min_stock: 10,
    hsn_code: '3506',
    tax_rate: 18,
  },
  '8901084056789': {
    name: 'M-Seal Regular Epoxy Sealant Compound 100g',
    item_code: 'MSEAL-100G',
    category: 'Plumbing',
    brand: 'Astral',
    stock_unit: 'PCS',
    purchase_price: 22,
    selling_price: 30,
    mrp: 35,
    min_stock: 50,
    hsn_code: '3506',
    tax_rate: 18,
  },
  '8901030112233': {
    name: 'Asian Paints Apex Ultima White 20L',
    item_code: 'AP-APEX-20L',
    category: 'Paint',
    brand: 'Asian Paints',
    stock_unit: 'LITRE',
    purchase_price: 3400,
    selling_price: 3850,
    mrp: 4250,
    min_stock: 4,
    hsn_code: '3208',
    tax_rate: 18,
  },
  '8901234500042': {
    name: 'Supreme PVC Heavy Pressure Pipe 1" (10ft)',
    item_code: 'SUP-PVC-1IN-10FT',
    category: 'Plumbing',
    brand: 'Astral',
    stock_unit: 'PCS',
    purchase_price: 160,
    selling_price: 195,
    mrp: 220,
    min_stock: 20,
    hsn_code: '3917',
    tax_rate: 18,
  },
  '8901234567890': {
    name: 'Bosch Standard Diamond Cutting Blade 5"',
    item_code: 'BOS-BLADE-5IN',
    category: 'Tools',
    brand: 'Bosch',
    stock_unit: 'PCS',
    purchase_price: 175,
    selling_price: 225,
    mrp: 260,
    min_stock: 12,
    hsn_code: '6804',
    tax_rate: 18,
  },
};

export function ImportItemsPage(): JSX.Element {
  const toast = useToast();


  // Active method selection: null means Overview selection screen, otherwise dedicated tool
  const [selectedMethod, setSelectedMethod] = useState<ImportMethod | null>(null);

  // -------------------------------------------------------------
  // Excel / CSV Importer State
  // -------------------------------------------------------------
  const [rows, setRows] = useState<ImportItemRow[]>(SAMPLE_CSV_ITEMS);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importSuccessResult, setImportSuccessResult] = useState<{ count: number; totalValue: number } | null>(null);

  // -------------------------------------------------------------
  // Master Library State
  // -------------------------------------------------------------
  const [selectedPackageIds, setSelectedPackageIds] = useState<string[]>(['pkg-paints', 'pkg-plumbing']);
  const [isLibraryImporting, setIsLibraryImporting] = useState(false);

  // -------------------------------------------------------------
  // Barcode Scanner State
  // -------------------------------------------------------------
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [barcodeQueue, setBarcodeQueue] = useState<ImportItemRow[]>([
    {
      ...SAMPLE_CSV_ITEMS[4],
      id: 'scanned-1',
      barcode: '8901234567890',
    },
  ]);

  // -------------------------------------------------------------
  // OCR Scanner State
  // -------------------------------------------------------------
  const [barcodeChecking, setBarcodeChecking] = useState(false);
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrCompleted, setOcrCompleted] = useState(false);

  // Helper to execute import for a list of items
  const executeBatchImport = async (itemsToImport: ImportItemRow[]) => {
    setIsImporting(true);
    setImportProgress(0);
    let successCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;
    let totalVal = 0;

    try {
      const res = await api.post<{ data: { created: number; updated: number; opening_stock: number; failed: string[] } }>(
        '/api/items/import',
        {
          rows: itemsToImport.map((r) => ({
            item_code: r.item_code.trim() || r.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-'),
            name: r.name.trim(),
            category: r.category,
            brand: r.brand,
            stock_unit: r.stock_unit,
            purchase_price: Number(r.purchase_price) || 0,
            selling_price: Number(r.selling_price) || 0,
            mrp: Number(r.mrp) || 0,
            min_stock: Number(r.min_stock) || 0,
            stock: Number(r.stock) || 0,
            barcode: r.barcode,
            hsn_code: r.hsn_code,
          })),
        },
      );
      successCount = res.data.created + res.data.updated;
      duplicateCount = res.data.updated;
      failedCount = res.data.failed.length;
      totalVal = itemsToImport.reduce((t, r) => t + Number(r.selling_price) * (Number(r.stock) || 0), 0);
      setImportProgress(100);
    } catch (err: unknown) {
      failedCount = itemsToImport.length;
      console.error(err);
    }

    setIsImporting(false);
    setImportSuccessResult({ count: successCount, totalValue: totalVal });
    const notes: string[] = [];
    if (duplicateCount) {
      notes.push(`${duplicateCount} already existed — prices updated`);
    }
    if (failedCount) notes.push(`${failedCount} could not be saved`);

    toast.toast({
      tone: successCount > 0 ? 'success' : 'error',
      title:
        successCount > 0
          ? `${successCount} item${successCount === 1 ? '' : 's'} added`
          : 'Nothing was imported',
      description: notes.length ? notes.join(' · ') : 'All rows imported.',
    });
  };

  // CSV download template generator
  const handleDownloadTemplate = () => {
    const csvContent =
      'Item Code,Item Name,Category,Brand,Unit,Purchase Price,Selling Price,MRP,Min Stock,Barcode,HSN Code,Tax Rate\n' +
      'AP-APEX-20L,"Asian Paints Apex Ultima White 20L",Paint,Asian Paints,LITRE,3400,3850,4250,4,8901030112233,3208,18\n' +
      'SUP-PVC-1IN,"Supreme PVC Heavy Pressure Pipe 1in (10ft)",Plumbing,Astral,PCS,160,195,220,20,8901234500042,3917,18\n' +
      'HAV-SW-16A,"Havells Reo 16A 1-Way Switch",Electrical,Havells,PCS,48,65,80,30,8901456789029,8536,18\n' +
      'GOD-LOCK-6L,"Godrej Brass Mortise Lock 6L",Hardware,Generic,PCS,420,520,580,5,8901876543210,8301,18\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'santu_hardware_items_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.toast({
      tone: 'success',
      title: 'Template Downloaded',
      description: 'santu_hardware_items_template.csv ready. Open and fill with your products.',
    });
  };

  /**
   * Reads a CSV or a real .xlsx. Column names are matched where present, so a
   * supplier's own header row works; otherwise columns are read in order.
   * Nothing missing is invented — blanks stay blank for the operator to fill.
   */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const { rows: parsed, skipped } = await parseSpreadsheet(file);

      if (parsed.length === 0) {
        toast.toast({
          tone: 'error',
          title: 'Nothing to import',
          description: 'No row in this file had an item name.',
        });
        return;
      }

      setRows(
        parsed.map((r, i) => ({
          id: `row-${Date.now()}-${i}`,
          item_code: r.item_code,
          name: r.name,
          category: r.category || 'Hardware',
          brand: r.brand || 'Generic',
          stock_unit: r.stock_unit || 'PCS',
          purchase_price: r.purchase_price,
          selling_price: r.selling_price,
          mrp: r.mrp,
          min_stock: r.min_stock,
          stock: r.stock,
          barcode: r.barcode,
          hsn_code: r.hsn_code,
          tax_rate: 0,
          status: 'ready',
        })),
      );

      toast.toast({
        tone: 'success',
        title: `${parsed.length} ${parsed.length === 1 ? 'row' : 'rows'} read from ${file.name}`,
        description: skipped
          ? `${skipped} row${skipped === 1 ? '' : 's'} had no item name and were left out. Check the prices before importing.`
          : 'Check the prices before importing.',
      });
    } catch {
      toast.toast({
        tone: 'error',
        title: 'Could not read this file',
        description: 'Use a .csv or .xlsx price list.',
      });
    }
  };

  /**
   * Loads the chosen starter packs into the import table. They are catalogue
   * suggestions with the shop's usual rates — the operator reviews and edits
   * them in the table before anything is saved.
   */
  const handleImportLibrary = () => {
    setIsLibraryImporting(true);
    const picked = MASTER_PACKAGES.filter((pkg) => selectedPackageIds.includes(pkg.id));
    const staged: ImportItemRow[] = picked.flatMap((pkg, p) =>
      pkg.items.map((item, i) => ({
        id: `lib-${pkg.id}-${p}-${i}`,
        item_code: item.item_code,
        name: item.name,
        category: item.category || pkg.category,
        brand: item.brand || pkg.brand,
        stock_unit: item.stock_unit || 'PCS',
        purchase_price: Number(item.purchase_price) || 0,
        selling_price: Number(item.selling_price) || 0,
        mrp: Number(item.mrp) || 0,
        min_stock: Number(item.min_stock) || 0,
        barcode: item.barcode || '',
        hsn_code: item.hsn_code || '',
        tax_rate: 0,
        status: 'ready',
      })),
    );

    setRows(staged);
    setSelectedMethod('excel');
    setIsLibraryImporting(false);
    toast.toast({
      tone: 'success',
      title: `${staged.length} items staged`,
      description: 'Review the rates, then press Import to add them to your catalogue.',
    });
  };

  /**
   * Looks a scanned barcode up against the shop's own catalogue first.
   *
   * The previous version consulted a hardcoded table and, for anything it did
   * not recognise, invented an item named "Hardware Item (123456)" priced at
   * Rs 80/110/125. Scanning something already in stock therefore created a
   * duplicate, and scanning anything new put made-up prices one click away
   * from a customer's bill.
   */
  const handleBarcodeLookup = async () => {
    const code = scannedBarcode.trim();
    if (!code) return;

    setBarcodeChecking(true);
    try {
      const found = await api.get<{ data: { item: Item; variant: ItemVariant } }>(
        `/api/items/barcode/${encodeURIComponent(code)}`,
      );
      setScannedBarcode('');
      toast.toast({
        tone: 'info',
        title: 'Already in your catalogue',
        description: `${found.data.item.name} · ${found.data.variant.name}. Nothing was added.`,
      });
      return;
    } catch (err) {
      // 404 is the useful answer here: the barcode is genuinely new.
      if (!(err instanceof ApiError) || err.status !== 404) {
        toast.toast({
          tone: 'error',
          title: 'Could not check this barcode',
          description: err instanceof ApiError ? err.message : undefined,
        });
        return;
      }
    } finally {
      setBarcodeChecking(false);
    }

    // A blank draft: the operator fills the name and prices. Nothing invented.
    setBarcodeQueue((prev) => [
      {
        id: `scanned-${Date.now()}`,
        item_code: '',
        name: '',
        category: 'Hardware',
        brand: 'Generic',
        stock_unit: 'PCS',
        purchase_price: 0,
        selling_price: 0,
        mrp: 0,
        min_stock: 0,
        barcode: code,
        hsn_code: '',
        tax_rate: 0,
        status: 'ready',
      },
      ...prev,
    ]);
    setScannedBarcode('');
    toast.toast({
      tone: 'success',
      title: 'New barcode',
      description: `${code} added as a blank row — fill in the name and prices.`,
    });
  };

  const handleRunOcr = () => {
    setOcrScanning(false);
    setOcrCompleted(false);
    toast.toast({
      tone: 'info',
      title: 'Bill photo reading is not available yet',
      description: 'Use the Excel / CSV importer, or type the items in for now.',
    });
  };

  // Total summary for Excel table
  const totalValuation = useMemo(
    () => rows.reduce((sum, r) => sum + (Number(r.selling_price) || 0) * (Number(r.min_stock) || 1), 0),
    [rows],
  );

  return (
    <div className="flex flex-col h-full bg-[#f4f7fb] overflow-y-auto font-sans select-none">
      {/* ----------------- TOP HEADER & BREADCRUMB ----------------- */}
      <div className="border-b border-slate-200 bg-white px-4 sm:px-6 py-3.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 border border-blue-100 p-2">
              <img src="/icons/items/bulk_update_item_icon.svg" alt="Bulk" className="h-6 w-6 object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Link
                  to="/items"
                  className="text-xs font-bold text-slate-500 hover:text-amber-600 transition-colors cursor-pointer flex items-center gap-1"
                >
                  <img src="/icons/items/Items.svg" alt="" className="h-3.5 w-3.5" />
                  <span>Items</span>
                </Link>
                <span className="text-slate-300">/</span>
                <button
                  type="button"
                  onClick={() => setSelectedMethod(null)}
                  className="text-lg font-black text-slate-900 tracking-tight hover:text-blue-600 transition-colors cursor-pointer"
                >
                  Update Items In Bulk
                </button>
                {selectedMethod && (
                  <>
                    <span className="text-slate-300">/</span>
                    <span className="text-sm font-bold text-blue-600 capitalize">
                      {selectedMethod === 'barcode' && 'Barcode Scanner'}
                      {selectedMethod === 'excel' && 'Excel / CSV Importer'}
                      {selectedMethod === 'ocr' && 'Invoice Photo OCR'}
                      {selectedMethod === 'library' && 'Santu Hardware Library'}
                    </span>
                  </>
                )}
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
                Bulk catalog upload, live barcode scanner, Santu Hardware library & distributor OCR
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {selectedMethod && (
              <button
                type="button"
                onClick={() => setSelectedMethod(null)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>All Import Methods</span>
              </button>
            )}
            <Link
              to="/items"
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors shadow-2xs"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-slate-400" />
              <Package className="h-3.5 w-3.5 text-amber-400" />
              <span>Back to Items</span>
            </Link>
          </div>
        </div>

        {/* Navigation Switcher Pills */}
        <div className="flex gap-1.5 overflow-x-auto pt-3 pb-0.5 no-scrollbar">
          <button
            type="button"
            onClick={() => setSelectedMethod(null)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer',
              selectedMethod === null
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )}
          >
            📋 Methods Overview
          </button>
          <button
            type="button"
            onClick={() => setSelectedMethod('excel')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer border',
              selectedMethod === 'excel'
                ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                : 'bg-white text-slate-700 border-slate-200/80 hover:bg-slate-50',
            )}
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500" />
            <span>Excel / CSV Importer</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedMethod('library')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer border',
              selectedMethod === 'library'
                ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                : 'bg-white text-slate-700 border-slate-200/80 hover:bg-slate-50',
            )}
          >
            <Library className="h-3.5 w-3.5 text-purple-500" />
            <span>Santu Hardware Library</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedMethod('barcode')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer border',
              selectedMethod === 'barcode'
                ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                : 'bg-white text-slate-700 border-slate-200/80 hover:bg-slate-50',
            )}
          >
            <Barcode className="h-3.5 w-3.5 text-amber-500" />
            <span>Barcode Scanner</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedMethod('ocr')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer border',
              selectedMethod === 'ocr'
                ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                : 'bg-white text-slate-700 border-slate-200/80 hover:bg-slate-50',
            )}
          >
            <FileText className="h-3.5 w-3.5 text-indigo-500" />
            <span>Bill Photo / OCR</span>
          </button>
        </div>
      </div>

      {/* ----------------- MAIN VIEW CONTENT ----------------- */}
      <div className="flex-1 p-4 sm:p-6">
        {/* =========================================================
            VIEW 1: METHODS OVERVIEW SELECTION (ORIGINAL CARDS DESIGN)
           ========================================================= */}
        {selectedMethod === null && (
          <div className="max-w-5xl space-y-6">
            <div>
              <h2 className="text-base font-extrabold text-slate-900 tracking-tight">
                Select Your Import Method
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Choose how you want to add bulk items into Santu Hardware inventory
              </p>
            </div>

            {/* Top 3 Methods Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Method 1: Barcode */}
              <div
                onClick={() => setSelectedMethod('barcode')}
                className="group relative rounded-2xl bg-white p-5 border-2 border-slate-200/90 hover:border-blue-500 hover:shadow-md transition-all cursor-pointer shadow-2xs flex flex-col justify-between"
              >
                <div>
                  <span className="inline-block rounded-md bg-[#22c55e] text-white text-[9px] font-black uppercase px-2 py-0.5 tracking-wider mb-3">
                    RECOMMENDED
                  </span>

                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 border border-amber-200/80 p-2 group-hover:scale-105 transition-transform shadow-2xs">
                      <img src="/images/items/barcodeScannerIcon.webp" alt="Barcode" className="h-7 w-7 object-contain" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                      Import From Barcode
                    </h3>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed mt-2">
                    Scan barcodes to find or create items using the Santu Hardware rapid scanner with auto-catalog match.
                  </p>
                </div>

                <div className="pt-4 mt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-blue-600">
                  <span>Open Scanner</span>
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>

              {/* Method 2: Excel */}
              <div
                onClick={() => setSelectedMethod('excel')}
                className="group relative rounded-2xl bg-white p-5 border-2 border-slate-200/90 hover:border-blue-500 hover:shadow-md transition-all cursor-pointer shadow-2xs flex flex-col justify-between"
              >
                <div>
                  <span className="inline-block rounded-md bg-blue-600 text-white text-[9px] font-black uppercase px-2 py-0.5 tracking-wider mb-3">
                    BULK EXCEL / CSV
                  </span>

                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 border border-emerald-200/80 p-2 group-hover:scale-105 transition-transform shadow-2xs">
                      <img src="/images/items/importFromExcel.webp" alt="Excel" className="h-7 w-7 object-contain" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                      Import From Excel
                    </h3>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed mt-2">
                    Upload .xlsx / .csv spreadsheet files with column mapping, live price editor, and 1-click database insert.
                  </p>
                </div>

                <div className="pt-4 mt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-blue-600">
                  <span>Open Excel Importer</span>
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>

              {/* Method 3: PDF / Photo OCR */}
              <div
                onClick={() => setSelectedMethod('ocr')}
                className="group relative rounded-2xl bg-white p-5 border-2 border-slate-200/90 hover:border-blue-500 hover:shadow-md transition-all cursor-pointer shadow-2xs flex flex-col justify-between"
              >
                <div>
                  <span className="inline-block rounded-md bg-indigo-600 text-white text-[9px] font-black uppercase px-2 py-0.5 tracking-wider mb-3">
                    AI INVOICE SCANNER
                  </span>

                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-800 group-hover:scale-105 transition-transform">
                      <FileText className="h-5 w-5" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                      Import From PDF / Photo
                    </h3>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed mt-2">
                    Supplier ki rate list — PDF ho, scan ho, ya mobile photo. OCR khud padhta hai aur items match karta hai.
                  </p>
                </div>

                <div className="pt-4 mt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-blue-600">
                  <span>Open OCR Scanner</span>
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </div>

            {/* OR Divider */}
            <div className="flex items-center justify-center my-2">
              <span className="text-xs font-extrabold text-slate-400 uppercase tracking-widest bg-[#f4f7fb] px-4">
                OR
              </span>
            </div>

            {/* Method 4: Hardware Library */}
            <div
              onClick={() => setSelectedMethod('library')}
              className="group relative rounded-2xl bg-white p-6 border-2 border-slate-200/90 hover:border-purple-500 hover:shadow-md transition-all cursor-pointer shadow-2xs flex items-center justify-between gap-4"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-50 border border-purple-200/80 p-2 text-purple-700 shrink-0 group-hover:scale-105 transition-transform shadow-2xs">
                  <img src="/icons/items/manage-items.svg" alt="Library" className="h-7 w-7 object-contain" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-extrabold text-slate-900 group-hover:text-purple-600 transition-colors">
                      Import From Santu Hardware Library (1-Click Packs)
                    </h3>
                    <span className="rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-[10px] font-bold">
                      Pre-loaded Master Catalogue
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
                    Asian Paints, Supreme PVC, Havells wires, Godrej locks aur Bosch power tools ke standard packages.
                    Bina type kare ek click me dukan ke catalogue me add karein.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 text-xs font-bold text-purple-600 shrink-0">
                <span>Browse Packs</span>
                <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            VIEW 2: EXCEL / CSV IMPORTER
           ========================================================= */}
        {selectedMethod === 'excel' && (
          <div className="space-y-5">
            {/* Top Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Excel / CSV Spreadsheet Importer</h3>
                <p className="text-[11px] text-slate-500">
                  Upload file, preview and edit rows, then click import to save directly into store database
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5 text-blue-600" />
                  <span>Download Blank CSV Template</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setRows(SAMPLE_CSV_ITEMS);
                    toast.toast({
                      tone: 'info',
                      title: 'Sample Data Loaded',
                      description: 'Loaded 5 realistic Santu Hardware products ready for import testing.',
                    });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 shadow-2xs cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Load Sample 5 Items</span>
                </button>

                <label className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 shadow-2xs cursor-pointer transition-colors">
                  <Upload className="h-3.5 w-3.5" />
                  <span>Upload .CSV / .XLSX</span>
                  <input type="file" accept=".csv,.xlsx,.xls,.txt" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>
            </div>

            {/* Summary KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Rows</span>
                <p className="text-xl font-black text-slate-900 mt-1">{rows.length} Items</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Ready To Import</span>
                <p className="text-xl font-black text-emerald-600 mt-1">
                  {rows.filter((r) => r.item_code && r.name).length} Valid
                </p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Estimated Valuation</span>
                <p className="text-xl font-black text-blue-600 mt-1">₹ {totalValuation.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Action</span>
                <button
                  type="button"
                  disabled={isImporting || rows.length === 0}
                  onClick={() => executeBatchImport(rows)}
                  className="mt-1 w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs py-1.5 shadow-2xs flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isImporting ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      <span>{importProgress}%</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                      <span>Import Now ({rows.length})</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Success Banner if import completed */}
            {importSuccessResult && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-center justify-between gap-4 animate-fade-in">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-emerald-900">
                      Import Succeeded! {importSuccessResult.count} items inserted into catalog.
                    </h4>
                    <p className="text-xs text-emerald-700">
                      Inventory valuation updated with ₹{importSuccessResult.totalValue.toLocaleString('en-IN')}. Items are live in POS & Bills.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Link
                    to="/items"
                    className="rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-3 py-1.5 shadow-2xs"
                  >
                    View in Items Catalog
                  </Link>
                  <Link
                    to="/pos"
                    className="rounded-lg bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100 text-xs font-bold px-3 py-1.5 shadow-2xs"
                  >
                    Create Bill
                  </Link>
                </div>
              </div>
            )}

            {/* Editable Data Preview Table */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
              <div className="p-3.5 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-800">Preview & Verify Rows Before Insert</span>
                  <span className="text-[10px] text-slate-500">(Click any cell to edit inline)</span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const newRow: ImportItemRow = {
                      id: `row-${Date.now()}`,
                      item_code: `ITEM-${Date.now().toString().slice(-4)}`,
                      name: 'New Hardware Item',
                      category: 'Hardware',
                      brand: 'Generic',
                      stock_unit: 'PCS',
                      purchase_price: 100,
                      selling_price: 130,
                      mrp: 150,
                      min_stock: 5,
                      barcode: '',
                      hsn_code: '8481',
                      tax_rate: 18,
                      status: 'ready',
                    };
                    setRows((prev) => [...prev, newRow]);
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-white border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer shadow-2xs"
                >
                  <Plus className="h-3 w-3" />
                  <span>Add Row</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100/70 text-[11px] font-black text-slate-600 uppercase tracking-wider">
                      <th className="p-2.5 w-12 text-center">#</th>
                      <th className="p-2.5 min-w-[140px]">Item Code</th>
                      <th className="p-2.5 min-w-[220px]">Product Name</th>
                      <th className="p-2.5 min-w-[110px]">Category</th>
                      <th className="p-2.5 min-w-[100px]">Brand</th>
                      <th className="p-2.5 min-w-[90px]">Unit</th>
                      <th className="p-2.5 min-w-[100px] text-right">Cost (₹)</th>
                      <th className="p-2.5 min-w-[100px] text-right">Sale (₹)</th>
                      <th className="p-2.5 min-w-[100px] text-right">MRP (₹)</th>
                      <th className="p-2.5 min-w-[80px] text-center">Min Stock</th>
                      <th className="p-2.5 min-w-[130px]">Barcode</th>
                      <th className="p-2.5 w-12 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row, index) => (
                      <tr key={row.id} className="hover:bg-blue-50/40 transition-colors">
                        <td className="p-2 text-center text-slate-400 font-bold">{index + 1}</td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.item_code}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRows((list) => list.map((r) => (r.id === row.id ? { ...r, item_code: val } : r)));
                            }}
                            className="w-full px-2 py-1 text-xs font-bold rounded border border-transparent hover:border-slate-200 focus:border-blue-500 focus:bg-white bg-transparent text-slate-900"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRows((list) => list.map((r) => (r.id === row.id ? { ...r, name: val } : r)));
                            }}
                            className="w-full px-2 py-1 text-xs font-semibold rounded border border-transparent hover:border-slate-200 focus:border-blue-500 focus:bg-white bg-transparent text-slate-900"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.category}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRows((list) => list.map((r) => (r.id === row.id ? { ...r, category: val } : r)));
                            }}
                            className="w-full px-2 py-1 text-xs rounded border border-transparent hover:border-slate-200 focus:border-blue-500 focus:bg-white bg-transparent text-slate-700"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.brand}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRows((list) => list.map((r) => (r.id === row.id ? { ...r, brand: val } : r)));
                            }}
                            className="w-full px-2 py-1 text-xs rounded border border-transparent hover:border-slate-200 focus:border-blue-500 focus:bg-white bg-transparent text-slate-700"
                          />
                        </td>
                        <td className="p-2">
                          <select
                            value={row.stock_unit}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRows((list) => list.map((r) => (r.id === row.id ? { ...r, stock_unit: val } : r)));
                            }}
                            className="w-full px-1.5 py-1 text-xs rounded border border-slate-200 bg-white font-bold text-slate-800"
                          >
                            <option value="PCS">PCS</option>
                            <option value="BOX">BOX</option>
                            <option value="KG">KG</option>
                            <option value="LITRE">LITRE</option>
                            <option value="METER">METER</option>
                            <option value="BAG">BAG</option>
                            <option value="PACK">PACK</option>
                            <option value="SET">SET</option>
                          </select>
                        </td>
                        <td className="p-2 text-right">
                          <input
                            type="number"
                            value={row.purchase_price}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setRows((list) => list.map((r) => (r.id === row.id ? { ...r, purchase_price: val } : r)));
                            }}
                            className="w-20 px-2 py-1 text-right text-xs font-semibold rounded border border-transparent hover:border-slate-200 focus:border-blue-500 focus:bg-white bg-transparent text-slate-800"
                          />
                        </td>
                        <td className="p-2 text-right">
                          <input
                            type="number"
                            value={row.selling_price}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setRows((list) => list.map((r) => (r.id === row.id ? { ...r, selling_price: val } : r)));
                            }}
                            className="w-20 px-2 py-1 text-right text-xs font-bold rounded border border-transparent hover:border-slate-200 focus:border-blue-500 focus:bg-white bg-transparent text-emerald-700"
                          />
                        </td>
                        <td className="p-2 text-right">
                          <input
                            type="number"
                            value={row.mrp}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setRows((list) => list.map((r) => (r.id === row.id ? { ...r, mrp: val } : r)));
                            }}
                            className="w-20 px-2 py-1 text-right text-xs font-bold rounded border border-transparent hover:border-slate-200 focus:border-blue-500 focus:bg-white bg-transparent text-slate-900"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <input
                            type="number"
                            value={row.min_stock}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setRows((list) => list.map((r) => (r.id === row.id ? { ...r, min_stock: val } : r)));
                            }}
                            className="w-14 px-1 py-1 text-center text-xs rounded border border-transparent hover:border-slate-200 focus:border-blue-500 focus:bg-white bg-transparent text-slate-700"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.barcode}
                            placeholder="Scan / Type"
                            onChange={(e) => {
                              const val = e.target.value;
                              setRows((list) => list.map((r) => (r.id === row.id ? { ...r, barcode: val } : r)));
                            }}
                            className="w-full px-2 py-1 text-xs rounded border border-transparent hover:border-slate-200 focus:border-blue-500 focus:bg-white bg-transparent font-mono text-slate-700"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => setRows((list) => list.filter((r) => r.id !== row.id))}
                            className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            title="Delete row"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            VIEW 3: SANTU HARDWARE MASTER LIBRARY (1-CLICK PACKS)
           ========================================================= */}
        {selectedMethod === 'library' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Santu Hardware Master Catalogue Packs</h3>
                <p className="text-[11px] text-slate-500">
                  Select popular brand packs and import ready products directly into your store with 1 click
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedPackageIds.length === MASTER_PACKAGES.length) {
                      setSelectedPackageIds([]);
                    } else {
                      setSelectedPackageIds(MASTER_PACKAGES.map((p) => p.id));
                    }
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs"
                >
                  {selectedPackageIds.length === MASTER_PACKAGES.length ? 'Deselect All' : 'Select All Packs'}
                </button>

                <button
                  type="button"
                  disabled={isLibraryImporting || selectedPackageIds.length === 0}
                  onClick={handleImportLibrary}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white px-4 py-1.5 text-xs font-bold shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isLibraryImporting ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Importing to Catalog...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>1-Click Import Selected ({selectedPackageIds.length} Packs)</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Packages Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {MASTER_PACKAGES.map((pkg) => {
                const isChecked = selectedPackageIds.includes(pkg.id);
                return (
                  <div
                    key={pkg.id}
                    className={cn(
                      'rounded-2xl border-2 bg-white p-5 shadow-2xs transition-all flex flex-col justify-between',
                      isChecked ? 'border-purple-500 ring-2 ring-purple-100' : 'border-slate-200/90',
                    )}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPackageIds((prev) => [...prev, pkg.id]);
                              } else {
                                setSelectedPackageIds((prev) => prev.filter((id) => id !== pkg.id));
                              }
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                          />
                          <h4 className="text-sm font-bold text-slate-900">{pkg.title}</h4>
                        </div>
                        <span className="rounded-full bg-purple-100 text-purple-800 px-2.5 py-0.5 text-[10px] font-black uppercase">
                          {pkg.badge}
                        </span>
                      </div>

                      <p className="text-xs text-slate-500 mb-3">{pkg.description}</p>

                      {/* Items Preview List */}
                      <div className="space-y-1.5 bg-slate-50/80 rounded-xl p-3 border border-slate-100">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                          Includes {pkg.items.length} Products:
                        </span>
                        {pkg.items.map((it, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs py-0.5">
                            <span className="text-slate-700 font-semibold truncate pr-2">
                              • {it.name}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-slate-400 text-[11px]">₹{it.purchase_price}</span>
                              <span className="font-bold text-slate-900 text-[11px]">Sale: ₹{it.selling_price}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium">Brand: {pkg.brand}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          const items = pkg.items.map((it, i) => ({
                            ...it,
                            id: `${pkg.id}-${i}`,
                            status: 'ready' as const,
                          }));
                          await executeBatchImport(items);
                        }}
                        className="font-bold text-purple-600 hover:text-purple-700 cursor-pointer"
                      >
                        Import This Pack Only →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* =========================================================
            VIEW 4: BARCODE SCANNER IMPORTER
           ========================================================= */}
        {selectedMethod === 'barcode' && (
          <div className="space-y-5 max-w-4xl">
            <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
                  <Barcode className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Rapid Barcode Scanner</h3>
                  <p className="text-[11px] text-slate-500">
                    Scan with handheld USB/Bluetooth scanner or enter product barcode numbers
                  </p>
                </div>
              </div>

              {/* Barcode Input Bar */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={scannedBarcode}
                    onChange={(e) => setScannedBarcode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !barcodeChecking) void handleBarcodeLookup();
                    }}
                    placeholder="Scan barcode or type 13-digit EAN code (e.g. 8901084012345)..."
                    disabled={barcodeChecking}
                    className="w-full h-11 pl-10 pr-3 rounded-xl border-2 border-amber-300 focus:border-blue-500 bg-amber-50/20 text-sm font-mono focus:bg-white focus:outline-none disabled:opacity-60"
                    autoFocus
                  />
                  <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-amber-600 pointer-events-none" />
                </div>

                <button
                  type="button"
                  onClick={handleBarcodeLookup}
                  className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-5 shadow-2xs transition-colors cursor-pointer"
                >
                  Lookup Code
                </button>
              </div>

              {/* Quick Barcode Testing Pills */}
              <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase text-slate-400">Click to test quick codes:</span>
                {Object.keys(KNOWN_BARCODE_LOOKUP).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      setScannedBarcode(code);
                    }}
                    className="rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-mono px-2 py-1 transition-colors cursor-pointer"
                  >
                    {code}
                  </button>
                ))}
              </div>
            </div>

            {/* Scanned Queue Table */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
              <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">
                  Scanned Products Queue ({barcodeQueue.length})
                </span>

                <button
                  type="button"
                  disabled={barcodeQueue.length === 0 || isImporting}
                  onClick={() => executeBatchImport(barcodeQueue)}
                  className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-1.5 shadow-2xs disabled:opacity-50 cursor-pointer"
                >
                  {isImporting ? 'Importing...' : `Import All (${barcodeQueue.length})`}
                </button>
              </div>

              <div className="divide-y divide-slate-100">
                {barcodeQueue.map((item) => (
                  <div key={item.id} className="p-3.5 flex items-center justify-between text-xs hover:bg-slate-50">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded">
                          {item.barcode}
                        </span>
                        <h4 className="font-bold text-slate-900">{item.name}</h4>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Code: {item.item_code} · {item.category} · {item.stock_unit}
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className="font-black text-slate-900">₹{item.selling_price}</span>
                        <p className="text-[10px] text-slate-400">MRP: ₹{item.mrp}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setBarcodeQueue((q) => q.filter((x) => x.id !== item.id))}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            VIEW 5: INVOICE PHOTO / OCR IMPORTER
           ========================================================= */}
        {selectedMethod === 'ocr' && (
          <div className="space-y-5 max-w-4xl">
            <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-800">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Supplier Invoice OCR Scanner</h3>
                  <p className="text-[11px] text-slate-500">
                    Upload photo or scan of wholesale invoice. AI automatically extracts line items, wholesale rates, and HSN.
                  </p>
                </div>
              </div>

              {/* Upload Dropzone */}
              <div className="rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/30 p-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 mx-auto mb-2">
                  <Upload className="h-6 w-6" />
                </div>
                <h4 className="text-xs font-bold text-slate-800">
                  Drop supplier bill photo or PDF here
                </h4>
                <p className="text-[11px] text-slate-500 mt-1">Supports PNG, JPG, or PDF distributor invoices</p>

                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={handleRunOcr}
                    disabled={ocrScanning}
                    className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 shadow-2xs flex items-center gap-1.5 cursor-pointer"
                  >
                    {ocrScanning ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Scanning Distributor Bill...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Test Scan Sample Distributor Bill (#AP-2026-901)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Extracted Items */}
            {ocrCompleted && (
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs animate-fade-in">
                <div className="p-3.5 bg-indigo-50/60 border-b border-indigo-100 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-indigo-950">
                      Extracted Items from Invoice #AP-2026-901
                    </span>
                    <span className="text-[11px] text-indigo-600 block">Asian Paints Wholesale Distributor Saran</span>
                  </div>

                  <button
                    type="button"
                    disabled={isImporting}
                    onClick={() => executeBatchImport(SAMPLE_CSV_ITEMS.slice(0, 3))}
                    className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-1.5 shadow-2xs cursor-pointer"
                  >
                    {isImporting ? 'Importing...' : 'Add All to Store Inventory'}
                  </button>
                </div>

                <div className="divide-y divide-slate-100">
                  {SAMPLE_CSV_ITEMS.slice(0, 3).map((item) => (
                    <div key={item.id} className="p-3.5 flex items-center justify-between text-xs">
                      <div>
                        <h4 className="font-bold text-slate-900">{item.name}</h4>
                        <p className="text-[11px] text-slate-400">HSN: {item.hsn_code} · Tax: {item.tax_rate}% · Unit: {item.stock_unit}</p>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-slate-900">Wholesale: ₹{item.purchase_price}</span>
                        <p className="text-[10px] text-emerald-600 font-semibold">Suggested Sale: ₹{item.selling_price}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ImportItemsPage;
