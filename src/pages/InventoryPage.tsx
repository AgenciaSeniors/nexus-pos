import { useState, useRef, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { db, type Product, type Staff, type InventoryMovement } from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    Plus, Search, Edit2, Trash2, Package, Loader2, History as HistoryIcon,
    LayoutList, ClipboardEdit, AlertTriangle, ArrowRightLeft, X, Download, Bell, Clock,
    Upload, FileSpreadsheet, CheckCircle2, XCircle, SkipForward
} from 'lucide-react';
import { syncPush, addToQueue } from '../lib/sync';
import { currency } from '../lib/currency';
import { toast } from 'sonner';
import { logAuditAction } from '../lib/audit';
import { InventoryHistory } from '../components/InventoryHistory';

export function InventoryPage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id');

  const [activeTab, setActiveTab] = useState<'stock' | 'history'>('stock');
  const [searchTerm, setSearchTerm] = useState('');
  
  // MODALES
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [deleteConfirmProduct, setDeleteConfirmProduct] = useState<Product | null>(null);
  
  // ✅ NUEVO MODAL DE ALERTAS
  const [showAlertsModal, setShowAlertsModal] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // --- DATOS FORMULARIO PRODUCTO ---
  const [formData, setFormData] = useState({
    name: '', price: '', sku: '', cost: '',
    category: '', unit: '', expiration_date: '', low_stock_threshold: ''
  });

  // --- DATOS AJUSTE STOCK ---
  const [stockAdjustment, setStockAdjustment] = useState({
      newStock: 0,
      reason: 'restock',
      target: 'warehouse' as 'display' | 'warehouse',
      notes: ''
  });

  // --- MODAL TRANSFERENCIA ALMACÉN ↔ VITRINA ---
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferQty, setTransferQty] = useState('');
  const [transferDirection, setTransferDirection] = useState<'to_display' | 'to_warehouse'>('to_display');

  // CARGA DE PRODUCTOS
  const products = useLiveQuery(async () => {
    if (!businessId) return [];
    return await db.products
      .where('business_id').equals(businessId)
      .filter(p => !p.deleted_at)
      .reverse()
      .sortBy('created_at');
  }, [businessId]) || [];

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sku?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ✅ LÓGICA DE ALERTAS (Bajo Stock y Vencimiento)
  const getDaysUntilExpiration = (dateString?: string) => {
      if (!dateString) return null;
      const expDate = new Date(dateString);
      if (isNaN(expDate.getTime())) return null;
      const today = new Date();
      expDate.setHours(0, 0, 0, 0);
      today.setHours(0, 0, 0, 0);
      const diffTime = expDate.getTime() - today.getTime();
      return Math.ceil(diffTime / (1000 * 3600 * 24));
  };

  const LOW_STOCK_DEFAULT = 5;
  const { lowStockProducts, expiringProducts, totalAlerts } = useMemo(() => {
    const low = products.filter(p => p.stock <= (p.low_stock_threshold ?? LOW_STOCK_DEFAULT));
    const expiring = products.filter(p => {
      const days = getDaysUntilExpiration(p.expiration_date);
      return days !== null && days <= 90;
    });
    return { lowStockProducts: low, expiringProducts: expiring, totalAlerts: low.length + expiring.length };
  }, [products]);

  // --- 1. GUARDAR PRODUCTO ---
  const handleSubmitProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;
    setIsLoading(true);

    try {
        if (formData.sku) {
            const duplicate = await db.products
                .where({ business_id: businessId, sku: formData.sku })
                .filter(p => !p.deleted_at && p.id !== editingProduct?.id)
                .first();
            
            if (duplicate) {
                toast.warning(`El SKU "${formData.sku}" ya existe.`);
                setIsLoading(false);
                return;
            }
        }

        const thresholdVal = parseInt(formData.low_stock_threshold);
        const productData = {
            name: formData.name.trim(),
            price: parseFloat(formData.price) || 0,
            cost: parseFloat(formData.cost) || 0,
            sku: formData.sku.trim(),
            category: formData.category.trim() || 'General',
            unit: formData.unit.trim() || 'un',
            expiration_date: formData.expiration_date,
            low_stock_threshold: !isNaN(thresholdVal) && thresholdVal >= 0 ? thresholdVal : undefined
        };

        if (editingProduct) {
            const updated = { ...editingProduct, ...productData, sync_status: 'pending_update' as const };
            await db.products.put(updated);
            await addToQueue('PRODUCT_SYNC', updated);
            await logAuditAction('UPDATE_PRODUCT', { name: updated.name }, currentStaff);
            toast.success('Información actualizada');
        } else {
            const newProduct: Product = {
                id: crypto.randomUUID(),
                business_id: businessId,
                ...productData,
                stock: 0, 
                sync_status: 'pending_create',
                created_at: new Date().toISOString()
            };

            await db.products.add(newProduct);
            await addToQueue('PRODUCT_SYNC', newProduct);
            await logAuditAction('CREATE_PRODUCT', { name: newProduct.name }, currentStaff);
            toast.success(`"${newProduct.name}" creado correctamente`);
        }

        setIsFormOpen(false);
        resetForm();
        syncPush().catch(console.error);

    } catch (error) {
        console.error(error);
        toast.error('Error al guardar');
    } finally {
        setIsLoading(false);
    }
  };

  // --- 2. AJUSTE DE STOCK ---
  const getStockTarget = (reason: string) => {
    if (reason === 'restock') return 'warehouse';
    if (reason === 'return') return 'display';
    return stockAdjustment.target; // damage, correction → user chooses
  };

  const handleStockAdjustment = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingProduct || !businessId) return;
      setIsLoading(true);

      try {
          const target = getStockTarget(stockAdjustment.reason);
          const isWarehouse = target === 'warehouse';
          const currentStock = isWarehouse ? (editingProduct.stock_warehouse ?? 0) : editingProduct.stock;
          const newStock = parseFloat(stockAdjustment.newStock.toString());

          if (isNaN(newStock) || newStock < 0) {
              toast.error("El stock no puede ser negativo");
              setIsLoading(false);
              return;
          }

          const difference = newStock - currentStock;

          if (difference === 0) {
              toast.info("No hay cambios en el stock");
              setIsStockModalOpen(false);
              return;
          }

          const reasonKey = isWarehouse && !['restock'].includes(stockAdjustment.reason)
            ? `${stockAdjustment.reason}_warehouse`
            : isWarehouse ? 'restock_warehouse' : stockAdjustment.reason;

          await db.transaction('rw', [db.products, db.movements, db.action_queue, db.audit_logs], async () => {
              const updatedProduct = {
                  ...editingProduct,
                  ...(isWarehouse
                    ? { stock_warehouse: newStock }
                    : { stock: newStock }),
                  sync_status: 'pending_update' as const
              };
              await db.products.put(updatedProduct);
              await addToQueue('PRODUCT_SYNC', updatedProduct);

              const movement: InventoryMovement = {
                  id: crypto.randomUUID(),
                  business_id: businessId,
                  product_id: editingProduct.id,
                  staff_id: currentStaff.id,
                  qty_change: difference,
                  reason: reasonKey,
                  created_at: new Date().toISOString(),
                  sync_status: 'pending_create'
              };
              await db.movements.add(movement);
              await addToQueue('MOVEMENT', movement);

              await logAuditAction('UPDATE_STOCK', {
                  product: editingProduct.name,
                  target: isWarehouse ? 'almacén' : 'vitrina',
                  old: currentStock,
                  new: newStock,
                  reason: stockAdjustment.reason
              }, currentStaff);
          });

          toast.success(isWarehouse ? 'Almacén actualizado' : 'Vitrina actualizada');
          setIsStockModalOpen(false);
          setEditingProduct(null);
          syncPush().catch(console.error);

      } catch (error) {
          console.error(error);
          toast.error("Error al ajustar stock");
      } finally {
          setIsLoading(false);
      }
  };

  // --- TRANSFERENCIA ALMACÉN ↔ VITRINA (bidireccional) ---
  const handleTransfer = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingProduct || !businessId) return;
      const qty = parseFloat(transferQty);
      const warehouseStock = editingProduct.stock_warehouse ?? 0;
      const displayStock = editingProduct.stock;
      const isToDisplay = transferDirection === 'to_display';

      if (isNaN(qty) || qty <= 0) { toast.error("Ingresa una cantidad válida"); return; }
      if (isToDisplay && qty > warehouseStock) { toast.error(`Solo hay ${warehouseStock} en almacén`); return; }
      if (!isToDisplay && qty > displayStock) { toast.error(`Solo hay ${displayStock} en vitrina`); return; }

      setIsLoading(true);
      try {
          await db.transaction('rw', [db.products, db.movements, db.action_queue, db.audit_logs], async () => {
              const updatedProduct = {
                  ...editingProduct,
                  stock: isToDisplay ? displayStock + qty : displayStock - qty,
                  stock_warehouse: isToDisplay ? warehouseStock - qty : warehouseStock + qty,
                  sync_status: 'pending_update' as const
              };
              await db.products.put(updatedProduct);
              await addToQueue('PRODUCT_SYNC', updatedProduct);

              const movement: InventoryMovement = {
                  id: crypto.randomUUID(),
                  business_id: businessId,
                  product_id: editingProduct.id,
                  staff_id: currentStaff.id,
                  qty_change: isToDisplay ? qty : -qty,
                  reason: isToDisplay ? 'transfer_to_display' : 'transfer_to_warehouse',
                  created_at: new Date().toISOString(),
                  sync_status: 'pending_create'
              };
              await db.movements.add(movement);
              await addToQueue('MOVEMENT', movement);

              await logAuditAction('UPDATE_STOCK', {
                  product: editingProduct.name,
                  action: 'transfer',
                  qty,
                  from: isToDisplay ? 'almacén' : 'vitrina',
                  to: isToDisplay ? 'vitrina' : 'almacén'
              }, currentStaff);
          });

          toast.success(`${qty} ${editingProduct.unit || 'un'} transferido(s) a ${isToDisplay ? 'vitrina' : 'almacén'}`);
          setIsTransferModalOpen(false);
          setEditingProduct(null);
          setTransferQty('');
          syncPush().catch(console.error);
      } catch (error) {
          console.error(error);
          toast.error("Error al transferir");
      } finally {
          setIsLoading(false);
      }
  };

  // =============================================
  // IMPORTACIÓN CSV
  // =============================================
  const importFileRef = useRef<HTMLInputElement>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importStep, setImportStep] = useState<'instructions' | 'preview' | 'importing' | 'done'>('instructions');
  const [importResults, setImportResults] = useState<{
    valid: Partial<Product>[]; errors: { row: number; message: string }[]; skipped: { row: number; sku: string; name: string }[];
  }>({ valid: [], errors: [], skipped: [] });
  const [importProgress, setImportProgress] = useState(0);
  const [importedCount, setImportedCount] = useState(0);

  // Header mapping: normalizes any common variation to internal field name
  const HEADER_MAP: Record<string, keyof Product> = {
    'nombre del producto': 'name', 'nombre': 'name', 'product name': 'name', 'producto': 'name',
    'sku': 'sku', 'codigo': 'sku', 'código': 'sku', 'code': 'sku',
    'categoria': 'category', 'categoría': 'category', 'category': 'category',
    'precio venta': 'price', 'precio': 'price', 'price': 'price', 'sale price': 'price',
    'costo': 'cost', 'cost': 'cost',
    'stock vitrina': 'stock', 'stock': 'stock', 'display stock': 'stock', 'existencia': 'stock',
    'stock almacen': 'stock_warehouse', 'stock almacén': 'stock_warehouse', 'warehouse stock': 'stock_warehouse', 'almacen': 'stock_warehouse', 'almacén': 'stock_warehouse',
    'unidad de medida': 'unit', 'unidad': 'unit', 'unit': 'unit',
    'vencimiento': 'expiration_date', 'expiration': 'expiration_date', 'expiration date': 'expiration_date', 'fecha vencimiento': 'expiration_date',
    'alerta stock': 'low_stock_threshold', 'low stock': 'low_stock_threshold', 'stock minimo': 'low_stock_threshold', 'stock mínimo': 'low_stock_threshold',
  };

  const parseCSVLine = (line: string, separator: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { current += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === separator) { result.push(current.trim()); current = ''; }
        else { current += ch; }
      }
    }
    result.push(current.trim());
    return result;
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (importFileRef.current) importFileRef.current.value = '';

    const text = await file.text();
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length < 2) { toast.error('El archivo está vacío o no tiene datos'); return; }

    // Detect separator: if first line has more ; than , use ;
    const separator = (lines[0].split(';').length > lines[0].split(',').length) ? ';' : ',';

    // Parse headers
    const rawHeaders = parseCSVLine(lines[0], separator);
    const fieldMap: (keyof Product | null)[] = rawHeaders.map(h => {
      const normalized = h.toLowerCase().replace(/['"]/g, '').trim();
      return HEADER_MAP[normalized] || null;
    });

    // Check minimum required headers
    const hasName = fieldMap.includes('name');
    const hasPrice = fieldMap.includes('price');
    if (!hasName && !hasPrice) {
      toast.error('No se encontraron columnas de "Nombre" ni "Precio". Verifica el formato del CSV.');
      return;
    }

    // Load existing SKUs for duplicate check
    const existingProducts = await db.products.where('business_id').equals(businessId!).filter(p => !p.deleted_at).toArray();
    const existingSKUs = new Set(existingProducts.map(p => p.sku?.toLowerCase()).filter(Boolean));

    const valid: Partial<Product>[] = [];
    const errors: { row: number; message: string }[] = [];
    const skipped: { row: number; sku: string; name: string }[] = [];
    const csvSKUs = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i], separator);
      const row: Record<string, string> = {};
      fieldMap.forEach((field, idx) => { if (field && values[idx] !== undefined) row[field] = values[idx]; });

      const rowNum = i + 1;
      const name = (row.name || '').replace(/^["']|["']$/g, '').trim();
      if (!name) { errors.push({ row: rowNum, message: 'Nombre vacío' }); continue; }

      const price = parseFloat(row.price || '0');
      if (isNaN(price) || price < 0) { errors.push({ row: rowNum, message: `Precio inválido: "${row.price}"` }); continue; }

      let sku = (row.sku || '').replace(/^["']|["']$/g, '').trim();
      if (!sku) sku = `IMP-${String(i).padStart(4, '0')}`;

      // SKU duplicate in DB
      if (existingSKUs.has(sku.toLowerCase())) { skipped.push({ row: rowNum, sku, name }); continue; }
      // SKU duplicate within CSV
      if (csvSKUs.has(sku.toLowerCase())) { errors.push({ row: rowNum, message: `SKU "${sku}" duplicado en el CSV` }); continue; }
      csvSKUs.add(sku.toLowerCase());

      const cost = Math.max(0, parseFloat(row.cost || '0') || 0);
      const stock = Math.max(0, parseFloat(row.stock || '0') || 0);
      const stockWarehouse = Math.max(0, parseFloat(row.stock_warehouse || '0') || 0);
      const category = (row.category || '').replace(/^["']|["']$/g, '').trim() || 'General';
      const unit = (row.unit || '').replace(/^["']|["']$/g, '').trim() || 'un';
      const expirationRaw = (row.expiration_date || '').replace(/^["']|["']$/g, '').trim();
      const expiration_date = /^\d{4}-\d{2}-\d{2}/.test(expirationRaw) ? expirationRaw.slice(0, 10) : '';
      const thresholdRaw = parseInt(row.low_stock_threshold || '');
      const low_stock_threshold = !isNaN(thresholdRaw) && thresholdRaw >= 0 ? thresholdRaw : undefined;

      valid.push({ name, price, cost, sku, category, unit, stock, stock_warehouse: stockWarehouse || undefined, expiration_date: expiration_date || undefined, low_stock_threshold });
    }

    setImportResults({ valid, errors, skipped });
    setImportStep('preview');
  };

  const executeImport = async () => {
    if (!businessId || importResults.valid.length === 0) return;
    setImportStep('importing');
    setImportProgress(0);
    setImportedCount(0);

    const total = importResults.valid.length;
    const BATCH_SIZE = 50;

    try {
      // Preparar todos los datos primero
      const allProducts: Product[] = [];
      const allMovements: InventoryMovement[] = [];

      for (const item of importResults.valid) {
        const product: Product = {
          id: crypto.randomUUID(),
          business_id: businessId,
          name: item.name!,
          price: item.price!,
          cost: item.cost,
          sku: item.sku!,
          category: item.category,
          unit: item.unit,
          stock: item.stock ?? 0,
          stock_warehouse: item.stock_warehouse,
          expiration_date: item.expiration_date,
          low_stock_threshold: item.low_stock_threshold,
          created_at: new Date().toISOString(),
          sync_status: 'pending_create',
        };
        allProducts.push(product);

        if (product.stock > 0) {
          allMovements.push({
            id: crypto.randomUUID(), business_id: businessId, product_id: product.id,
            staff_id: currentStaff.id, qty_change: product.stock,
            reason: 'initial', created_at: new Date().toISOString(), sync_status: 'pending_create'
          });
        }
        if ((product.stock_warehouse ?? 0) > 0) {
          allMovements.push({
            id: crypto.randomUUID(), business_id: businessId, product_id: product.id,
            staff_id: currentStaff.id, qty_change: product.stock_warehouse!,
            reason: 'restock_warehouse', created_at: new Date().toISOString(), sync_status: 'pending_create'
          });
        }
      }

      // Insertar en lotes con bulkAdd
      let imported = 0;
      for (let i = 0; i < allProducts.length; i += BATCH_SIZE) {
        const batch = allProducts.slice(i, i + BATCH_SIZE);
        await db.products.bulkAdd(batch);
        for (const p of batch) await addToQueue('PRODUCT_SYNC', p);
        imported += batch.length;
        setImportedCount(imported);
        setImportProgress(Math.round((imported / total) * 100));
      }

      // Movimientos en bulk
      if (allMovements.length > 0) {
        await db.movements.bulkAdd(allMovements);
        for (const m of allMovements) await addToQueue('MOVEMENT', m);
      }

      await logAuditAction('CREATE_PRODUCT', { action: 'csv_import', count: imported }, currentStaff);
      syncPush().catch(console.error);
      setImportStep('done');
      toast.success(`${imported} productos importados correctamente`);
    } catch (error) {
      console.error('Import error:', error);
      toast.error(`Error durante la importación.`);
      setImportStep('done');
    }
  };

  const downloadTemplate = () => {
    const headers = 'Nombre del Producto,SKU,Categoría,Precio Venta,Costo,Stock Vitrina,Stock Almacén,Unidad de Medida,Vencimiento\n';
    const example = 'Coca Cola 600ml,BEB-001,Bebidas,25.00,18.00,20,100,un,\nArroz 1kg,ALM-001,Alimentos,45.50,32.00,15,80,kg,2026-12-31\n';
    const blob = new Blob(["\uFEFF" + headers + example], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'Plantilla_Inventario_Bisne.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const closeImportModal = () => {
    setIsImportModalOpen(false);
    setImportStep('instructions');
    setImportResults({ valid: [], errors: [], skipped: [] });
    setImportProgress(0);
    setImportedCount(0);
  };

  const handleDelete = (product: Product) => {
      setDeleteConfirmProduct(product);
  };

  const confirmDelete = async () => {
      if (!deleteConfirmProduct) return;
      const product = deleteConfirmProduct;
      setDeleteConfirmProduct(null);
      try {
          // Contar ventas recientes que referencian este producto
          const recentSales = await db.sales
            .where('business_id').equals(businessId)
            .filter(s => s.status !== 'voided' && (s.items || []).some(i => i.product_id === product.id))
            .count();

          const deleted = { ...product, deleted_at: new Date().toISOString(), sync_status: 'pending_update' as const };
          await db.products.put(deleted);
          await addToQueue('PRODUCT_SYNC', deleted);
          await logAuditAction('DELETE_PRODUCT', {
            product_id: product.id,
            name: product.name,
            sku: product.sku,
            price: product.price,
            cost: product.cost,
            stock: product.stock,
            stock_warehouse: product.stock_warehouse,
            category: product.category,
            sales_count: recentSales
          }, currentStaff);

          toast.success(recentSales > 0
            ? `Producto eliminado (tenía ${recentSales} venta${recentSales > 1 ? 's' : ''} registrada${recentSales > 1 ? 's' : ''})`
            : "Producto eliminado");
          syncPush().catch(console.error);
      } catch {
          toast.error("Error al eliminar");
      }
  };

  // EXPORTAR A EXCEL (CSV)
  const handleExportCSV = () => {
    if (products.length === 0) {
        toast.error("No hay productos para exportar");
        return;
    }

    const headers = ['Nombre del Producto', 'SKU', 'Categoría', 'Precio Venta', 'Costo', 'Stock Vitrina', 'Stock Almacén', 'Stock Total', 'Unidad de Medida', 'Vencimiento'];

    const csvRows = products.map(p => {
        const warehouse = p.stock_warehouse ?? 0;
        return [
            `"${p.name.replace(/"/g, '""')}"`,
            `"${p.sku || ''}"`,
            `"${p.category || 'General'}"`,
            p.price,
            p.cost || 0,
            p.stock,
            warehouse,
            p.stock + warehouse,
            `"${p.unit || 'un'}"`,
            `"${p.expiration_date || ''}"`
        ].join(',');
    });

    const csvContent = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Inventario_Bisne_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast.success("Inventario exportado correctamente");
  };

  const openEdit = (p: Product) => {
      setEditingProduct(p);
      setFormData({
          name: p.name, price: p.price.toString(), cost: p.cost?.toString() || '',
          sku: p.sku || '', category: p.category || 'General', unit: p.unit || 'un',
          expiration_date: p.expiration_date || '',
          low_stock_threshold: p.low_stock_threshold !== undefined ? p.low_stock_threshold.toString() : ''
      });
      setIsFormOpen(true);
  };

  const openStock = (p: Product) => {
      setEditingProduct(p);
      setStockAdjustment({ newStock: p.stock_warehouse ?? 0, reason: 'restock', target: 'warehouse', notes: '' });
      setIsStockModalOpen(true);
  };

  const openTransfer = (p: Product) => {
      setEditingProduct(p);
      setTransferQty('');
      setTransferDirection('to_display');
      setIsTransferModalOpen(true);
  };

  const openHistory = (p: Product) => {
      setEditingProduct(p);
      setIsHistoryModalOpen(true);
  };

  const resetForm = () => {
      setEditingProduct(null);
      setFormData({ name: '', price: '', cost: '', sku: '', category: '', unit: '', expiration_date: '', low_stock_threshold: '' });
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto pb-24 animate-in fade-in duration-300">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B3B68] flex items-center gap-2">
            <Package className="text-[#7AC142]"/> Inventario
          </h1>
          <p className="text-[#6B7280] text-sm">Control de existencias y precios</p>
        </div>

        <div className="flex bg-white p-1 rounded-xl border border-gray-200 shadow-sm">
            <button 
                onClick={() => setActiveTab('stock')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'stock' ? 'bg-[#0B3B68] text-white shadow-md' : 'text-[#6B7280] hover:bg-gray-50'}`}
            >
                <LayoutList size={16} /> Stock
            </button>
            <button 
                onClick={() => setActiveTab('history')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'history' ? 'bg-[#0B3B68] text-white shadow-md' : 'text-[#6B7280] hover:bg-gray-50'}`}
            >
                <HistoryIcon size={16} /> Global
            </button>
        </div>

        {activeTab === 'stock' && (
            <div className="flex flex-wrap gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-56 group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280] w-4 h-4 group-focus-within:text-[#0B3B68]" />
                    <input 
                        type="text" 
                        placeholder="Buscar..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B3B68] outline-none shadow-sm transition-all text-[#1F2937]"
                    />
                </div>
                
                {/* ✅ BOTÓN DE ALERTAS (CAMPANA) */}
                <button 
                    onClick={() => setShowAlertsModal(true)}
                    className="relative bg-white border border-gray-200 text-[#6B7280] hover:bg-gray-50 hover:text-orange-500 px-3 py-2.5 rounded-xl flex items-center justify-center transition-colors shadow-sm"
                    title="Alertas de Inventario"
                >
                    <Bell size={18} />
                    {totalAlerts > 0 && (
                        <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-white animate-pulse">
                            {totalAlerts > 99 ? '99+' : totalAlerts}
                        </span>
                    )}
                </button>

                <button
                    onClick={() => { setIsImportModalOpen(true); setImportStep('instructions'); }}
                    className="bg-white border border-gray-200 text-[#6B7280] hover:bg-gray-50 hover:text-[#0B3B68] px-3 py-2.5 rounded-xl flex items-center gap-2 font-bold text-sm transition-colors shadow-sm"
                    title="Importar desde CSV"
                >
                    <Upload size={18}/> <span className="hidden sm:inline">Importar</span>
                </button>
                <button
                    onClick={handleExportCSV}
                    className="bg-white border border-gray-200 text-[#6B7280] hover:bg-gray-50 hover:text-[#0B3B68] px-3 py-2.5 rounded-xl flex items-center gap-2 font-bold text-sm transition-colors shadow-sm"
                    title="Exportar a Excel"
                >
                    <Download size={18}/> <span className="hidden sm:inline">Exportar</span>
                </button>

                <button 
                    onClick={() => { resetForm(); setIsFormOpen(true); }}
                    className="bg-[#7AC142] hover:bg-[#7AC142]/90 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 font-bold text-sm transition-colors shadow-lg shadow-[#7AC142]/20"
                >
                    <Plus size={18}/> <span className="hidden sm:inline">Nuevo</span>
                </button>
            </div>
        )}
      </div>

      {activeTab === 'stock' ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            {filteredProducts.length === 0 ? (
                products.length === 0 ? (
                  /* Catálogo vacío — onboarding para negocio nuevo */
                  <div className="p-12 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-[#0B3B68] flex items-center justify-center mx-auto mb-4">
                      <Package size={32} className="text-white" />
                    </div>
                    <h3 className="text-lg font-black text-[#1F2937] mb-1">¡Agrega tu primer producto!</h3>
                    <p className="text-sm text-[#6B7280] mb-5">Tu catálogo está vacío. Empieza creando los productos que vendes.</p>
                    <button
                      onClick={() => { setEditingProduct(null); resetForm(); setIsFormOpen(true); }}
                      className="inline-flex items-center gap-2 bg-[#0B3B68] text-white font-bold px-5 py-3 rounded-xl hover:bg-[#0B3B68]/90 transition-colors shadow-md"
                    >
                      <Plus size={18}/> Crear primer producto
                    </button>
                  </div>
                ) : (
                  /* Sin resultados de búsqueda */
                  <div className="p-12 text-center text-[#6B7280]">
                    <Package className="w-12 h-12 opacity-20 mb-2 mx-auto"/>
                    <p>No se encontraron productos con ese término.</p>
                  </div>
                )
            ) : (
                <div className="overflow-x-auto">
                    <table className="mobile-card-table w-full text-left border-collapse">
                        <thead className="bg-[#F3F4F6] text-[#6B7280] uppercase text-xs font-bold tracking-wider">
                            <tr>
                                <th className="p-4">Detalle Producto</th>
                                <th className="p-4">Precios</th>
                                <th className="p-4 text-center">Existencia</th>
                                <th className="p-4 text-right">Gestión</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredProducts.map(product => {
                                const daysToExpiry = getDaysUntilExpiration(product.expiration_date);
                                const isExpiringSoon = daysToExpiry !== null && daysToExpiry <= 90;
                                const threshold = product.low_stock_threshold ?? LOW_STOCK_DEFAULT;
                                const isLowStock = product.stock <= threshold;

                                return (
                                <tr key={product.id} className="hover:bg-gray-50 transition-colors group">
                                    <td className="p-4" data-label="Producto">
                                        <div className="text-right md:text-left">
                                            <div className="font-bold text-[#1F2937]">{product.name}</div>
                                            <div className="flex items-center justify-end md:justify-start gap-2 mt-1 flex-wrap">
                                                <span className="text-[10px] font-mono bg-gray-100 px-1.5 rounded text-[#6B7280] border border-gray-200">{product.sku || 'SIN SKU'}</span>
                                                <span className="text-[10px] bg-[#0B3B68]/10 text-[#0B3B68] px-1.5 rounded font-bold uppercase">{product.category}</span>
                                                {isExpiringSoon && (
                                                    <span className={`text-[10px] px-1.5 rounded font-bold flex items-center gap-1 ${daysToExpiry < 0 ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}>
                                                        <Clock size={10}/> {daysToExpiry < 0 ? 'Vencido' : 'Próximo a Vencer'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4 text-sm" data-label="Precio">
                                        <div className="text-right md:text-left">
                                            <div className="font-bold text-[#7AC142]">{currency.format(product.price)}</div>
                                            {product.cost && <div className="text-xs text-[#6B7280]">Costo: {currency.format(product.cost)}</div>}
                                        </div>
                                    </td>
                                    <td className="p-4 text-center" data-label="Stock">
                                        <div className="flex flex-col items-end md:items-center w-full gap-1">
                                            <div className={`inline-flex flex-col items-center justify-center px-3 py-1 rounded-lg border ${
                                                isLowStock
                                                    ? 'bg-[#F59E0B]/10 border-[#F59E0B]/20 text-[#F59E0B]'
                                                    : 'bg-[#7AC142]/10 border-[#7AC142]/20 text-[#7AC142]'
                                            }`}>
                                                <span className="text-[9px] uppercase font-bold opacity-60">Vitrina</span>
                                                <span className="text-lg font-black leading-none">{product.stock}</span>
                                                <span className="text-[9px] uppercase font-bold opacity-70">{product.unit}</span>
                                            </div>
                                            {(product.stock_warehouse ?? 0) > 0 && (
                                                <div className="inline-flex flex-col items-center px-2 py-0.5 rounded border bg-blue-50 border-blue-100 text-blue-600">
                                                    <span className="text-[8px] uppercase font-bold opacity-60">Almacén</span>
                                                    <span className="text-sm font-black leading-none">{product.stock_warehouse}</span>
                                                </div>
                                            )}
                                            {isLowStock && (
                                                <div className="text-[9px] font-bold text-[#F59E0B] flex items-center justify-center gap-1">
                                                    <AlertTriangle size={10}/> BAJO STOCK
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-4 text-right" data-label="Acciones">
                                        <div className="flex justify-end gap-1.5 w-full flex-wrap">
                                            {(product.stock_warehouse ?? 0) > 0 && (
                                                <button onClick={() => openTransfer(product)} className="p-2 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors" title="Abastecer Vitrina">
                                                    <ArrowRightLeft size={18}/>
                                                </button>
                                            )}
                                            <button onClick={() => openStock(product)} className="p-2 text-[#0B3B68] bg-[#0B3B68]/10 hover:bg-[#0B3B68]/20 rounded-lg transition-colors" title="Ajustar Stock">
                                                <ClipboardEdit size={18}/>
                                            </button>
                                            <button onClick={() => openHistory(product)} className="p-2 text-[#6B7280] hover:text-[#1F2937] hover:bg-gray-100 rounded-lg transition-colors" title="Ver Movimientos">
                                                <HistoryIcon size={18}/>
                                            </button>
                                            <div className="w-px h-8 bg-gray-200 mx-1"></div>
                                            <button onClick={() => openEdit(product)} className="p-2 text-[#6B7280] hover:text-[#0B3B68] hover:bg-[#0B3B68]/5 rounded-lg" title="Editar Info">
                                                <Edit2 size={18}/>
                                            </button>
                                            <button onClick={() => handleDelete(product)} className="p-2 text-[#6B7280] hover:text-[#EF4444] hover:bg-[#EF4444]/10 rounded-lg" title="Eliminar">
                                                <Trash2 size={18}/>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                </div>
            )}
          </div>
      ) : (
          <InventoryHistory /> 
      )}

      {/* ✅ MODAL 0: CENTRO DE ALERTAS */}
      {showAlertsModal && (
        <div className="fixed inset-0 bg-[#0B3B68]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-[#F3F4F6]">
                    <h2 className="font-bold text-lg text-[#1F2937] flex items-center gap-2">
                        <Bell className="text-orange-500" /> Centro de Alertas
                    </h2>
                    <button onClick={() => setShowAlertsModal(false)}><X className="text-gray-400 hover:text-gray-600" /></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-5 bg-gray-50 space-y-6">
                    {/* ALERTA 1: BAJO STOCK */}
                    <div>
                        <h3 className="font-bold text-[#1F2937] mb-3 flex items-center gap-2">
                            <AlertTriangle className="text-red-500" size={18} /> 
                            Productos con Bajo Stock ({lowStockProducts.length})
                        </h3>
                        {lowStockProducts.length === 0 ? (
                            <p className="text-sm text-gray-500 italic bg-white p-4 rounded-xl border border-gray-200 text-center">Todo en orden. No hay bajo stock.</p>
                        ) : (
                            <div className="space-y-2">
                                {lowStockProducts.map(p => (
                                    <div key={p.id} className="bg-white p-3 rounded-xl border border-red-100 shadow-sm flex justify-between items-center">
                                        <div>
                                            <p className="font-bold text-[#1F2937] text-sm">{p.name}</p>
                                            <p className="text-xs text-gray-500">{p.sku || 'Sin código'} · Umbral: {p.low_stock_threshold ?? LOW_STOCK_DEFAULT} {p.unit}</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="bg-red-100 text-red-600 px-2 py-1 rounded text-xs font-bold border border-red-200">
                                                Quedan {p.stock} {p.unit}
                                            </span>
                                            <button onClick={() => {setShowAlertsModal(false); openStock(p);}} className="text-[#0B3B68] text-xs font-bold hover:underline">Reabastecer</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ALERTA 2: VENCIMIENTOS CERCANOS */}
                    <div>
                        <h3 className="font-bold text-[#1F2937] mb-3 flex items-center gap-2">
                            <Clock className="text-orange-500" size={18} /> 
                            Vencimientos Próximos (3 meses) o Vencidos ({expiringProducts.length})
                        </h3>
                        {expiringProducts.length === 0 ? (
                            <p className="text-sm text-gray-500 italic bg-white p-4 rounded-xl border border-gray-200 text-center">No hay productos próximos a vencer.</p>
                        ) : (
                            <div className="space-y-2">
                                {expiringProducts.map(p => {
                                    const days = getDaysUntilExpiration(p.expiration_date)!;
                                    const isExpired = days < 0;
                                    const statusColor = isExpired ? 'bg-red-100 text-red-600 border-red-200' : 'bg-orange-100 text-orange-700 border-orange-200';
                                    const statusText = isExpired ? `Venció hace ${Math.abs(days)} días` : days === 0 ? 'Vence HOY' : `Vence en ${days} días`;

                                    return (
                                        <div key={p.id} className="bg-white p-3 rounded-xl border border-orange-100 shadow-sm flex justify-between items-center">
                                            <div>
                                                <p className="font-bold text-[#1F2937] text-sm">{p.name}</p>
                                                <p className="text-xs text-gray-500">Fecha: {new Date(p.expiration_date!).toLocaleDateString()}</p>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className={`px-2 py-1 rounded text-xs font-bold border ${statusColor}`}>
                                                    {statusText}
                                                </span>
                                                <button onClick={() => {setShowAlertsModal(false); openEdit(p);}} className="text-[#0B3B68] text-xs font-bold hover:underline">Editar</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* --- MODAL 1: FORMULARIO PRODUCTO --- */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-[#0B3B68]/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-[#F3F4F6] flex-shrink-0">
               <h3 className="font-bold text-lg text-[#0B3B68]">
                 {editingProduct ? 'Editar Detalles' : 'Nuevo Producto'}
               </h3>
               <button onClick={() => setIsFormOpen(false)}><X className="text-gray-400 hover:text-gray-600"/></button>
            </div>

            <form id="product-form" onSubmit={handleSubmitProduct} className="flex-1 overflow-y-auto p-5 space-y-4">
               <div>
                 <label className="text-xs font-bold text-[#6B7280] uppercase">Nombre del Producto</label>
                 <input required type="text" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none font-medium" 
                   value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}/>
               </div>
               
               <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="text-xs font-bold text-[#6B7280] uppercase">Precio Venta</label>
                     <input required type="number" step="0.01" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none font-bold text-[#7AC142]" 
                       value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})}/>
                   </div>
                   <div>
                     <label className="text-xs font-bold text-[#6B7280] uppercase">Costo (Opcional)</label>
                     <input type="number" step="0.01" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none" 
                       value={formData.cost} onChange={e => setFormData({...formData, cost: e.target.value})}/>
                   </div>
               </div>

               <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="text-xs font-bold text-[#6B7280] uppercase">Código / SKU</label>
                     <input type="text" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none font-mono text-sm"
                       value={formData.sku} onChange={e => setFormData({...formData, sku: e.target.value})}/>
                   </div>
                   <div>
                     <label className="text-xs font-bold text-[#6B7280] uppercase">Vencimiento</label>
                     <input type="date" className={`w-full p-3 border rounded-xl focus:ring-2 focus:ring-[#0B3B68] ${formData.expiration_date && formData.expiration_date < new Date().toISOString().slice(0, 10) ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                       value={formData.expiration_date} onChange={e => setFormData({...formData, expiration_date: e.target.value})}/>
                     {formData.expiration_date && formData.expiration_date < new Date().toISOString().slice(0, 10) && (
                       <p className="text-[10px] text-red-500 font-bold mt-1">Este producto ya está vencido</p>
                     )}
                   </div>
               </div>

               <div>
                 <label className="text-xs font-bold text-[#6B7280] uppercase flex items-center gap-1">
                   <Bell size={11} className="text-orange-400"/> Alerta de Stock Bajo
                 </label>
                 <div className="flex items-center gap-3 mt-1">
                   <input
                     type="number" min="0" step="1"
                     placeholder={`Por defecto: 5 ${formData.unit || 'un'}`}
                     className="flex-1 p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-300 outline-none text-sm"
                     value={formData.low_stock_threshold}
                     onChange={e => setFormData({...formData, low_stock_threshold: e.target.value})}
                   />
                   {formData.low_stock_threshold !== '' && (
                     <span className="text-xs text-orange-500 font-bold whitespace-nowrap">
                       Alerta al llegar a {formData.low_stock_threshold} {formData.unit || 'un'}
                     </span>
                   )}
                 </div>
                 <p className="text-[10px] text-[#6B7280] mt-1">Recibirás una alerta cuando el stock llegue a este número. Deja vacío para usar el valor por defecto (5).</p>
               </div>

               {/* ── CATEGORÍA ───────────────────────────────────────────── */}
               <div>
                 <label className="text-xs font-bold text-[#6B7280] uppercase">Categoría</label>
                 <input type="text" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none mt-1"
                   placeholder="Ej. Bebidas, Ropa..."
                   value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}/>
                 {(() => {
                   const savedCats = [...new Set((products || []).map(p => p.category).filter(Boolean))].sort() as string[];
                   if (savedCats.length === 0) return null;
                   return (
                     <div className="flex flex-wrap gap-1.5 mt-2">
                       {savedCats.map(cat => (
                         <button key={cat} type="button"
                           onClick={() => setFormData(f => ({...f, category: cat}))}
                           className={`px-3 py-1 rounded-full text-xs font-bold transition-all active:scale-95 border ${formData.category === cat ? 'bg-[#0B3B68] text-white border-[#0B3B68] shadow-sm' : 'bg-white text-[#6B7280] border-gray-200 hover:border-[#0B3B68] hover:text-[#0B3B68]'}`}>
                           {cat}
                         </button>
                       ))}
                     </div>
                   );
                 })()}
               </div>

               {/* ── UNIDAD ──────────────────────────────────────────────── */}
               {(() => {
                 const PRESET = [
                   { value: 'un', label: 'Unidad' },
                   { value: 'kg', label: 'Kilos' },
                   { value: 'lt', label: 'Litros' },
                   { value: 'pq', label: 'Paquete' },
                   { value: 'cj', label: 'Caja' },
                   { value: 'dz', label: 'Docena' },
                 ];
                 const presetValues = PRESET.map(p => p.value);
                 const customUnits = [...new Set((products || []).map(p => p.unit).filter(u => u && !presetValues.includes(u)))] as string[];
                 const isCustom = formData.unit && !presetValues.includes(formData.unit);
                 return (
                   <div>
                     <label className="text-xs font-bold text-[#6B7280] uppercase">Unidad de Medida</label>
                     <div className="flex flex-wrap gap-2 mt-2">
                       {PRESET.map(opt => (
                         <button key={opt.value} type="button"
                           onClick={() => setFormData(f => ({...f, unit: opt.value}))}
                           className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 border ${formData.unit === opt.value ? 'bg-[#0B3B68] text-white border-[#0B3B68] shadow-md' : 'bg-white text-[#6B7280] border-gray-200 hover:border-[#0B3B68] hover:text-[#0B3B68]'}`}>
                           {opt.label}
                         </button>
                       ))}
                       {customUnits.map(u => (
                         <button key={u} type="button"
                           onClick={() => setFormData(f => ({...f, unit: u}))}
                           className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 border ${formData.unit === u ? 'bg-[#7AC142] text-white border-[#7AC142] shadow-md' : 'bg-white text-[#6B7280] border-gray-200 hover:border-[#7AC142] hover:text-[#7AC142]'}`}>
                           {u}
                         </button>
                       ))}
                     </div>
                     <div className="mt-2 relative">
                       <input type="text" autoComplete="off"
                         placeholder="O escribe una unidad personalizada..."
                         className={`w-full p-2.5 border rounded-xl text-sm outline-none transition-all focus:ring-2 ${isCustom ? 'border-[#7AC142] ring-[#7AC142]/30 bg-[#7AC142]/5 font-bold text-[#1F2937]' : 'border-gray-200 focus:ring-[#0B3B68] text-[#6B7280]'}`}
                         value={isCustom ? formData.unit : ''}
                         onChange={e => setFormData(f => ({...f, unit: e.target.value}))}
                         onFocus={e => { if (!isCustom) e.target.value = ''; }}
                       />
                       {isCustom && (
                         <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-[#7AC142] uppercase tracking-wide">Personalizada</span>
                       )}
                     </div>
                   </div>
                 );
               })()}

            </form>
            <div className="p-4 border-t border-gray-100 flex gap-3 flex-shrink-0 bg-white">
                 <button type="button" onClick={() => setIsFormOpen(false)} className="flex-1 py-3 bg-white border border-[#0B3B68] text-[#0B3B68] font-bold rounded-xl hover:bg-[#0B3B68]/5">Cancelar</button>
                 <button type="submit" form="product-form" disabled={isLoading} className="flex-1 py-3 bg-[#7AC142] text-white font-bold rounded-xl hover:bg-[#7AC142]/90 flex justify-center items-center gap-2 shadow-lg shadow-[#7AC142]/20">
                   {isLoading ? <Loader2 className="animate-spin text-white"/> : 'Guardar Datos'}
                 </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 2: AJUSTE DE STOCK --- */}
      {isStockModalOpen && editingProduct && (
        <div className="fixed inset-0 bg-[#0B3B68]/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[92vh] flex flex-col overflow-hidden border-t-4 border-[#0B3B68]">
                <div className="p-4 bg-[#F3F4F6] border-b border-gray-100 text-center flex-shrink-0">
                    <h3 className="font-black text-[#1F2937] text-lg uppercase tracking-wide mb-1">Ajuste de Inventario</h3>
                    <p className="text-[#0B3B68] font-bold">{editingProduct.name}</p>
                </div>

                <form onSubmit={handleStockAdjustment} className="flex-1 overflow-y-auto p-5 space-y-4">

                    {/* MOTIVO DEL AJUSTE (primero, para determinar el target) */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-[#6B7280] uppercase">Motivo del Ajuste</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => setStockAdjustment({...stockAdjustment, reason: 'restock', target: 'warehouse', newStock: editingProduct.stock_warehouse ?? 0})} className={`p-2 text-xs font-bold rounded-lg border ${stockAdjustment.reason === 'restock' ? 'bg-[#0B3B68]/10 border-[#0B3B68] text-[#0B3B68]' : 'bg-white border-gray-200 text-[#6B7280]'}`}>Compra</button>
                            <button type="button" onClick={() => setStockAdjustment({...stockAdjustment, reason: 'damage', newStock: stockAdjustment.target === 'warehouse' ? (editingProduct.stock_warehouse ?? 0) : editingProduct.stock})} className={`p-2 text-xs font-bold rounded-lg border ${stockAdjustment.reason === 'damage' ? 'bg-[#EF4444]/10 border-[#EF4444] text-[#EF4444]' : 'bg-white border-gray-200 text-[#6B7280]'}`}>Merma/Daño</button>
                            <button type="button" onClick={() => setStockAdjustment({...stockAdjustment, reason: 'return', target: 'display', newStock: editingProduct.stock})} className={`p-2 text-xs font-bold rounded-lg border ${stockAdjustment.reason === 'return' ? 'bg-[#F59E0B]/10 border-[#F59E0B] text-[#F59E0B]' : 'bg-white border-gray-200 text-[#6B7280]'}`}>Devolución</button>
                            <button type="button" onClick={() => setStockAdjustment({...stockAdjustment, reason: 'correction', newStock: stockAdjustment.target === 'warehouse' ? (editingProduct.stock_warehouse ?? 0) : editingProduct.stock})} className={`p-2 text-xs font-bold rounded-lg border ${stockAdjustment.reason === 'correction' ? 'bg-gray-100 border-gray-500 text-[#1F2937]' : 'bg-white border-gray-200 text-[#6B7280]'}`}>Corrección</button>
                        </div>
                    </div>

                    {/* TARGET SELECTOR (solo para damage y correction) */}
                    {(stockAdjustment.reason === 'damage' || stockAdjustment.reason === 'correction') && (
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-[#6B7280] uppercase">Aplicar a</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button type="button" onClick={() => setStockAdjustment({...stockAdjustment, target: 'display', newStock: editingProduct.stock})} className={`p-2 text-xs font-bold rounded-lg border ${stockAdjustment.target === 'display' ? 'bg-[#7AC142]/10 border-[#7AC142] text-[#7AC142]' : 'bg-white border-gray-200 text-[#6B7280]'}`}>Vitrina</button>
                                <button type="button" onClick={() => setStockAdjustment({...stockAdjustment, target: 'warehouse', newStock: editingProduct.stock_warehouse ?? 0})} className={`p-2 text-xs font-bold rounded-lg border ${stockAdjustment.target === 'warehouse' ? 'bg-blue-50 border-blue-500 text-blue-600' : 'bg-white border-gray-200 text-[#6B7280]'}`}>Almacén</button>
                            </div>
                        </div>
                    )}

                    {/* INFO: a dónde va el ajuste */}
                    {stockAdjustment.reason === 'restock' && (
                        <p className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 font-bold text-center">Se ingresará al almacén</p>
                    )}
                    {stockAdjustment.reason === 'return' && (
                        <p className="text-[10px] text-[#7AC142] bg-[#7AC142]/10 border border-[#7AC142]/20 rounded-lg px-3 py-2 font-bold text-center">Se regresa a vitrina (producto vendido)</p>
                    )}

                    {/* STOCK ACTUAL → NUEVO */}
                    <div className="flex items-center justify-between bg-gray-100 p-3 rounded-xl border border-gray-200">
                        <div className="text-center flex-1">
                            <span className="block text-[10px] font-bold text-[#6B7280] uppercase">
                                {getStockTarget(stockAdjustment.reason) === 'warehouse' ? 'Almacén Actual' : 'Vitrina Actual'}
                            </span>
                            <span className="text-xl font-bold text-[#1F2937]">
                                {getStockTarget(stockAdjustment.reason) === 'warehouse' ? (editingProduct.stock_warehouse ?? 0) : editingProduct.stock}
                            </span>
                        </div>
                        <ArrowRightLeft className="text-[#6B7280]"/>
                        <div className="text-center flex-1">
                            <span className="block text-[10px] font-bold text-[#0B3B68] uppercase">Nuevo</span>
                            <input
                                type="number" step="0.01" autoFocus required
                                className="w-20 text-center font-bold text-xl bg-transparent border-b-2 border-[#0B3B68] outline-none text-[#0B3B68]"
                                value={stockAdjustment.newStock}
                                onChange={e => setStockAdjustment({...stockAdjustment, newStock: parseFloat(e.target.value) || 0})}
                                onFocus={e => e.target.select()}
                            />
                        </div>
                    </div>

                    <button type="submit" disabled={isLoading} className="w-full py-3 bg-[#0B3B68] hover:bg-[#0B3B68]/90 text-white font-bold rounded-xl shadow-lg transition-all flex justify-center items-center gap-2">
                        {isLoading ? <Loader2 className="animate-spin"/> : 'Confirmar Ajuste'}
                    </button>
                    <button type="button" onClick={() => setIsStockModalOpen(false)} className="w-full text-xs text-[#6B7280] hover:text-[#1F2937] font-bold">Cancelar</button>
                </form>
            </div>
        </div>
      )}

      {/* --- MODAL: TRANSFERENCIA ALMACÉN ↔ VITRINA --- */}
      {isTransferModalOpen && editingProduct && (() => {
        const isToDisplay = transferDirection === 'to_display';
        const maxQty = isToDisplay ? (editingProduct.stock_warehouse ?? 0) : editingProduct.stock;
        const qty = parseFloat(transferQty) || 0;
        const newWarehouse = isToDisplay ? (editingProduct.stock_warehouse ?? 0) - qty : (editingProduct.stock_warehouse ?? 0) + qty;
        const newDisplay = isToDisplay ? editingProduct.stock + qty : editingProduct.stock - qty;
        return (
        <div className="fixed inset-0 bg-[#0B3B68]/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className={`bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[92vh] flex flex-col overflow-hidden border-t-4 ${isToDisplay ? 'border-emerald-500' : 'border-blue-500'}`}>
                <div className={`p-4 border-b text-center flex-shrink-0 ${isToDisplay ? 'bg-emerald-50 border-emerald-100' : 'bg-blue-50 border-blue-100'}`}>
                    <h3 className={`font-black text-lg uppercase tracking-wide mb-1 ${isToDisplay ? 'text-emerald-700' : 'text-blue-700'}`}>
                        {isToDisplay ? 'Sacar a Vitrina' : 'Devolver a Almacén'}
                    </h3>
                    <p className="text-[#0B3B68] font-bold">{editingProduct.name}</p>
                </div>

                <form onSubmit={handleTransfer} className="flex-1 overflow-y-auto p-5 space-y-4">
                    {/* Selector de dirección */}
                    <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => { setTransferDirection('to_display'); setTransferQty(''); }}
                            className={`p-2.5 rounded-xl text-xs font-bold border-2 transition-all ${isToDisplay ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-white border-gray-200 text-[#6B7280] hover:border-gray-300'}`}>
                            Almacén → Vitrina
                        </button>
                        <button type="button" onClick={() => { setTransferDirection('to_warehouse'); setTransferQty(''); }}
                            className={`p-2.5 rounded-xl text-xs font-bold border-2 transition-all ${!isToDisplay ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white border-gray-200 text-[#6B7280] hover:border-gray-300'}`}>
                            Vitrina → Almacén
                        </button>
                    </div>

                    {/* Estado actual */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className={`rounded-xl p-3 text-center border ${!isToDisplay ? 'bg-emerald-50 border-emerald-200 ring-2 ring-emerald-300' : 'bg-blue-50 border-blue-100'}`}>
                            <span className="block text-[10px] font-bold text-blue-500 uppercase">Almacén</span>
                            <span className="text-2xl font-black text-blue-700">{editingProduct.stock_warehouse ?? 0}</span>
                            <span className="block text-[9px] font-bold text-blue-400 uppercase">{editingProduct.unit}</span>
                            {isToDisplay && <span className="text-[9px] text-emerald-600 font-bold">← origen</span>}
                            {!isToDisplay && <span className="text-[9px] text-blue-600 font-bold">← destino</span>}
                        </div>
                        <div className={`rounded-xl p-3 text-center border ${isToDisplay ? 'bg-emerald-50 border-emerald-200 ring-2 ring-emerald-300' : 'bg-[#7AC142]/10 border-[#7AC142]/20'}`}>
                            <span className="block text-[10px] font-bold text-[#7AC142] uppercase">Vitrina</span>
                            <span className="text-2xl font-black text-[#5a962e]">{editingProduct.stock}</span>
                            <span className="block text-[9px] font-bold text-[#7AC142] uppercase">{editingProduct.unit}</span>
                            {isToDisplay && <span className="text-[9px] text-emerald-600 font-bold">← destino</span>}
                            {!isToDisplay && <span className="text-[9px] text-blue-600 font-bold">← origen</span>}
                        </div>
                    </div>

                    {/* Cantidad a transferir */}
                    <div>
                        <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Cantidad a transferir</label>
                        <input
                            type="number" step="0.01" min="0.01" autoFocus required
                            max={maxQty}
                            placeholder="0"
                            className={`w-full p-3 text-xl font-bold text-center border-2 rounded-xl outline-none transition-colors ${isToDisplay ? 'border-emerald-200 focus:border-emerald-500' : 'border-blue-200 focus:border-blue-500'}`}
                            value={transferQty}
                            onChange={e => setTransferQty(e.target.value)}
                        />
                        <p className="text-[10px] text-[#6B7280] text-center mt-1">Disponible: {maxQty} {editingProduct.unit || 'un'}</p>
                    </div>

                    {/* Preview del resultado */}
                    {transferQty && qty > 0 && (
                        <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                            <p className="text-[10px] font-bold text-[#6B7280] uppercase mb-2 text-center">Resultado</p>
                            <div className="grid grid-cols-2 gap-3 text-center">
                                <div>
                                    <span className="text-[9px] font-bold text-blue-500 uppercase">Almacén</span>
                                    <span className="block text-lg font-black text-blue-700">{Math.max(0, newWarehouse)}</span>
                                </div>
                                <div>
                                    <span className="text-[9px] font-bold text-[#7AC142] uppercase">Vitrina</span>
                                    <span className="block text-lg font-black text-[#5a962e]">{Math.max(0, newDisplay)}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    <button type="submit" disabled={isLoading || !transferQty || qty <= 0 || qty > maxQty}
                        className={`w-full py-3 text-white font-bold rounded-xl shadow-lg transition-all flex justify-center items-center gap-2 disabled:opacity-50 ${isToDisplay ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                        {isLoading ? <Loader2 className="animate-spin"/> : <><ArrowRightLeft size={16}/> {isToDisplay ? 'Sacar a Vitrina' : 'Devolver a Almacén'}</>}
                    </button>
                    <button type="button" onClick={() => { setIsTransferModalOpen(false); setEditingProduct(null); }} className="w-full text-xs text-[#6B7280] hover:text-[#1F2937] font-bold">Cancelar</button>
                </form>
            </div>
        </div>
        );
      })()}

      {/* --- MODAL 3: HISTORIAL --- */}
      {isHistoryModalOpen && editingProduct && (
          <div className="fixed inset-0 bg-[#0B3B68]/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in zoom-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col">
                  <div className="p-4 border-b flex justify-between items-center bg-[#F3F4F6] rounded-t-2xl">
                      <div>
                        <h3 className="font-bold text-[#1F2937] flex items-center gap-2"><HistoryIcon size={18}/> Historial</h3>
                        <p className="text-xs text-[#0B3B68] font-bold uppercase">{editingProduct.name}</p>
                      </div>
                      <button onClick={() => setIsHistoryModalOpen(false)}><X className="text-[#6B7280] hover:text-[#1F2937]"/></button>
                  </div>
                  <div className="flex-1 overflow-hidden p-0 bg-gray-50">
                      <InventoryHistory productId={editingProduct.id} />
                  </div>
              </div>
          </div>
      )}

      {/* --- MODAL 4: CONFIRMACIÓN DE ELIMINACIÓN --- */}
      {deleteConfirmProduct && (
          <div className="fixed inset-0 bg-[#0B3B68]/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6 text-center animate-in zoom-in-95 duration-200">
                  <div className="w-14 h-14 bg-[#EF4444]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Trash2 size={28} className="text-[#EF4444]" />
                  </div>
                  <h3 className="font-bold text-lg text-[#1F2937] mb-1">¿Eliminar producto?</h3>
                  <p className="text-sm text-[#6B7280] mb-6">
                      Se eliminará <span className="font-bold text-[#1F2937]">"{deleteConfirmProduct.name}"</span>. Esta acción se puede revertir contactando soporte.
                  </p>
                  <div className="flex gap-3">
                      <button
                          onClick={() => setDeleteConfirmProduct(null)}
                          className="flex-1 py-2.5 border border-gray-200 text-[#6B7280] font-bold rounded-xl hover:bg-gray-50 transition-colors"
                      >
                          Cancelar
                      </button>
                      <button
                          onClick={confirmDelete}
                          className="flex-1 py-2.5 bg-[#EF4444] text-white font-bold rounded-xl hover:bg-[#EF4444]/90 transition-colors"
                      >
                          Eliminar
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* --- MODAL: IMPORTACIÓN CSV --- */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-[#0B3B68]/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-[#F3F4F6] flex-shrink-0">
              <h3 className="font-bold text-lg text-[#0B3B68] flex items-center gap-2">
                <FileSpreadsheet size={20} /> Importar Inventario
              </h3>
              {importStep !== 'importing' && (
                <button onClick={closeImportModal}><X className="text-gray-400 hover:text-gray-600" /></button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5">

              {/* PASO 1: INSTRUCCIONES */}
              {importStep === 'instructions' && (
                <div className="space-y-4">
                  <p className="text-sm text-[#6B7280]">
                    Sube un archivo <span className="font-bold">.csv</span> con tu catálogo de productos.
                    El archivo debe tener al menos las columnas de <span className="font-bold">Nombre</span> y <span className="font-bold">Precio</span>.
                  </p>

                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                    <p className="text-xs font-bold text-[#6B7280] uppercase mb-2">Columnas aceptadas</p>
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      <span className="text-[#1F2937] font-bold">Nombre *</span><span className="text-[#6B7280]">Nombre del producto</span>
                      <span className="text-[#1F2937] font-bold">Precio *</span><span className="text-[#6B7280]">Precio de venta</span>
                      <span className="text-[#6B7280]">SKU</span><span className="text-[#6B7280]">Código único (auto si vacío)</span>
                      <span className="text-[#6B7280]">Categoría</span><span className="text-[#6B7280]">Ej. Bebidas, Alimentos</span>
                      <span className="text-[#6B7280]">Costo</span><span className="text-[#6B7280]">Costo de compra</span>
                      <span className="text-[#6B7280]">Stock Vitrina</span><span className="text-[#6B7280]">Unidades en venta</span>
                      <span className="text-[#6B7280]">Stock Almacén</span><span className="text-[#6B7280]">Unidades en almacén</span>
                      <span className="text-[#6B7280]">Unidad</span><span className="text-[#6B7280]">un, kg, lt, etc.</span>
                      <span className="text-[#6B7280]">Vencimiento</span><span className="text-[#6B7280]">Formato: AAAA-MM-DD</span>
                    </div>
                    <p className="text-[10px] text-[#6B7280] mt-2">* Obligatorias. Las demás son opcionales. Columnas no reconocidas se ignoran.</p>
                  </div>

                  <div className="flex flex-col gap-3">
                    <button onClick={downloadTemplate} className="w-full py-3 bg-white border border-[#0B3B68] text-[#0B3B68] rounded-xl font-bold text-sm hover:bg-[#0B3B68]/5 transition-colors flex items-center justify-center gap-2">
                      <Download size={16} /> Descargar plantilla CSV
                    </button>
                    <button onClick={() => importFileRef.current?.click()} className="w-full py-3 bg-[#0B3B68] text-white rounded-xl font-bold text-sm hover:bg-[#0B3B68]/90 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-[#0B3B68]/20">
                      <Upload size={16} /> Seleccionar archivo .csv
                    </button>
                    <input type="file" accept=".csv,.txt" className="hidden" ref={importFileRef} onChange={handleImportFile} />
                  </div>
                </div>
              )}

              {/* PASO 2: PREVIEW */}
              {importStep === 'preview' && (
                <div className="space-y-4">
                  {/* Contadores */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
                      <CheckCircle2 size={20} className="mx-auto text-emerald-500 mb-1" />
                      <span className="text-2xl font-black text-emerald-700">{importResults.valid.length}</span>
                      <span className="block text-[10px] font-bold text-emerald-500 uppercase">Válidos</span>
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-center">
                      <XCircle size={20} className="mx-auto text-red-400 mb-1" />
                      <span className="text-2xl font-black text-red-600">{importResults.errors.length}</span>
                      <span className="block text-[10px] font-bold text-red-400 uppercase">Errores</span>
                    </div>
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-center">
                      <SkipForward size={20} className="mx-auto text-amber-400 mb-1" />
                      <span className="text-2xl font-black text-amber-600">{importResults.skipped.length}</span>
                      <span className="block text-[10px] font-bold text-amber-400 uppercase">Saltados</span>
                    </div>
                  </div>

                  {/* Preview de válidos */}
                  {importResults.valid.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-[#6B7280] uppercase mb-2">Productos a importar (primeros 10)</p>
                      <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-xl">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr><th className="p-2 text-left">Nombre</th><th className="p-2">Precio</th><th className="p-2">SKU</th><th className="p-2">Stock</th></tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {importResults.valid.slice(0, 10).map((p, i) => (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="p-2 font-bold text-[#1F2937]">{p.name}</td>
                                <td className="p-2 text-center text-[#7AC142] font-bold">${p.price?.toFixed(2)}</td>
                                <td className="p-2 text-center font-mono text-[#6B7280]">{p.sku}</td>
                                <td className="p-2 text-center">{p.stock ?? 0}{(p.stock_warehouse ?? 0) > 0 && <span className="text-blue-500"> +{p.stock_warehouse}A</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {importResults.valid.length > 10 && (
                        <p className="text-[10px] text-[#6B7280] mt-1 text-center">...y {importResults.valid.length - 10} más</p>
                      )}
                    </div>
                  )}

                  {/* Errores */}
                  {importResults.errors.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-red-500 uppercase mb-2">Errores encontrados</p>
                      <div className="max-h-32 overflow-y-auto bg-red-50 border border-red-100 rounded-xl p-3 space-y-1">
                        {importResults.errors.map((err, i) => (
                          <p key={i} className="text-xs text-red-700">Fila {err.row}: {err.message}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Saltados */}
                  {importResults.skipped.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-amber-500 uppercase mb-2">SKU duplicados (se saltan)</p>
                      <div className="max-h-24 overflow-y-auto bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-1">
                        {importResults.skipped.map((s, i) => (
                          <p key={i} className="text-xs text-amber-700">Fila {s.row}: "{s.name}" (SKU: {s.sku})</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Botones */}
                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setImportStep('instructions')} className="flex-1 py-3 border border-gray-200 text-[#6B7280] font-bold rounded-xl hover:bg-gray-50 transition-colors">
                      Volver
                    </button>
                    <button onClick={executeImport} disabled={importResults.valid.length === 0} className="flex-1 py-3 bg-[#7AC142] text-white font-bold rounded-xl hover:bg-[#7AC142]/90 transition-colors shadow-lg shadow-[#7AC142]/20 disabled:opacity-50 flex items-center justify-center gap-2">
                      <Upload size={16} /> Importar {importResults.valid.length}
                    </button>
                  </div>
                </div>
              )}

              {/* PASO 3: IMPORTANDO */}
              {importStep === 'importing' && (
                <div className="py-8 text-center space-y-6">
                  <Loader2 size={40} className="animate-spin text-[#0B3B68] mx-auto" />
                  <div>
                    <p className="text-lg font-bold text-[#1F2937]">Importando productos...</p>
                    <p className="text-sm text-[#6B7280] mt-1">{importedCount} de {importResults.valid.length}</p>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div className="bg-[#7AC142] h-full rounded-full transition-all duration-300" style={{ width: `${importProgress}%` }} />
                  </div>
                </div>
              )}

              {/* PASO 4: COMPLETADO */}
              {importStep === 'done' && (
                <div className="py-8 text-center space-y-4">
                  <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 size={32} className="text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-xl font-black text-[#1F2937]">{importedCount} productos importados</p>
                    {importResults.errors.length > 0 && <p className="text-sm text-red-500 mt-1">{importResults.errors.length} con errores (no importados)</p>}
                    {importResults.skipped.length > 0 && <p className="text-sm text-amber-500">{importResults.skipped.length} saltados (SKU duplicado)</p>}
                  </div>
                  <button onClick={closeImportModal} className="w-full py-3 bg-[#0B3B68] text-white font-bold rounded-xl hover:bg-[#0B3B68]/90 transition-colors">
                    Cerrar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}