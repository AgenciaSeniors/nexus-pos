import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
// ✅ CORRECCIÓN: Eliminados imports 'User' y 'History' que no se usaban
import { ArrowUpRight, ArrowDownLeft, PackageSearch } from 'lucide-react';

interface Props {
  productId?: string | null; 
}

export function InventoryHistory({ productId }: Props) {
  // 1. Consultamos los movimientos
  const historyData = useLiveQuery(async () => {
    // ✅ CORRECCIÓN: Cambiado 'let' a 'const' porque no se reasigna
    const collection = db.movements.orderBy('created_at').reverse();

    let movements = await collection.limit(productId ? 500 : 100).toArray();

    if (productId) {
        movements = movements.filter(m => m.product_id === productId);
    }

    const productIds = [...new Set(movements.map(m => m.product_id))];
    const staffIds = [...new Set(movements.map(m => m.staff_id).filter(id => !!id))];

    const products = await db.products.bulkGet(productIds);
    const staffMembers = await db.staff.bulkGet(staffIds as string[]);

    const productMap = new Map(products.filter(Boolean).map(p => [p!.id, p]));
    const staffMap = new Map(staffMembers.filter(Boolean).map(s => [s!.id, s]));

    return movements.map(m => ({
      ...m,
      productName: productMap.get(m.product_id)?.name || 'Producto Eliminado',
      productSku: productMap.get(m.product_id)?.sku || '---',
      staffName: m.staff_id ? (staffMap.get(m.staff_id)?.name || 'Desconocido') : 'Sistema',
    }));
  }, [productId]); 

  if (!historyData) {
    return <div className="p-12 text-center text-slate-400"><LoaderIcon /></div>;
  }

  if (historyData.length === 0) {
    return (
      <div className="p-12 text-center flex flex-col items-center text-slate-400">
        <PackageSearch size={48} className="opacity-20 mb-4" />
        <p>No hay movimientos registrados {productId ? 'para este producto' : 'recientemente'}.</p>
      </div>
    );
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('es-ES', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto max-h-[60vh]">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs sticky top-0 z-10">
            <tr>
              <th className="p-4">Fecha</th>
              {!productId && <th className="p-4">Producto</th>}
              <th className="p-4">Usuario</th>
              <th className="p-4 text-center">Cambio</th>
              <th className="p-4">Motivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {historyData.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="p-4 whitespace-nowrap text-slate-600 font-mono text-xs">
                  {formatDate(item.created_at)}
                </td>
                
                {!productId && (
                    <td className="p-4">
                    <div className="font-bold text-slate-800">{item.productName}</div>
                    <div className="text-xs text-slate-400 font-mono">{item.productSku}</div>
                    </td>
                )}

                <td className="p-4">
                  <div className="flex items-center gap-2 text-slate-700">
                    <div className="w-6 h-6 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 font-bold text-[10px]">
                      {item.staffName.substring(0,2).toUpperCase()}
                    </div>
                    <span className="text-xs font-medium">{item.staffName}</span>
                  </div>
                </td>
                
                <td className="p-4 text-center">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${
                      item.qty_change > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {item.qty_change > 0 ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
                    {item.qty_change > 0 ? '+' : ''}{item.qty_change}
                  </span>
                </td>
                
                <td className="p-4">
                  <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded border ${getReasonStyle(item.reason)}`}>
                    {translateReason(item.reason)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LoaderIcon() {
    return <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600 mx-auto"></div>;
}

function translateReason(reason: string) {
  const map: Record<string, string> = {
    'initial': 'Carga Inicial',
    'correction': 'Ajuste / Conteo',
    'sale': 'Venta',
    'restock': 'Compra / Ingreso',
    'return': 'Devolución',
    'damage': 'Merma / Daño',
    'gift': 'Regalo / Promo'
  };
  return map[reason] || reason;
}

function getReasonStyle(reason: string) {
    switch (reason) {
        case 'sale': return 'bg-white border-slate-200 text-slate-500';
        case 'restock': return 'bg-blue-50 border-blue-100 text-blue-600';
        case 'damage': return 'bg-red-50 border-red-100 text-red-600';
        case 'initial': return 'bg-indigo-50 border-indigo-100 text-indigo-600';
        default: return 'bg-slate-50 border-slate-200 text-slate-600';
    }
}