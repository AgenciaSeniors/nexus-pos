import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { ArrowUpRight, ArrowDownLeft, User, History } from 'lucide-react';

export function InventoryHistory() {
  // 1. Consultamos los movimientos y los datos relacionados
  const historyData = useLiveQuery(async () => {
    // Obtenemos los últimos 100 movimientos ordenados por fecha
    const movements = await db.movements
      .orderBy('created_at')
      .reverse()
      .limit(100)
      .toArray();

    // Obtenemos IDs únicos para hacer consultas eficientes
    const productIds = [...new Set(movements.map(m => m.product_id))];
    const staffIds = [...new Set(movements.map(m => m.staff_id).filter(id => !!id))];

    // Consultamos productos y staff
    const products = await db.products.bulkGet(productIds);
    // Nota: Si no tienes tabla 'staff' local, esto devolverá undefined para los nombres, 
    // pero el código lo maneja con "Sistema" o "Desconocido".
    const staffMembers = await db.staff.bulkGet(staffIds as string[]);

    // Mapeamos para acceso rápido
    const productMap = new Map(products.filter(Boolean).map(p => [p!.id, p]));
    const staffMap = new Map(staffMembers.filter(Boolean).map(s => [s!.id, s]));

    // Combinamos todo
    return movements.map(m => ({
      ...m,
      productName: productMap.get(m.product_id)?.name || 'Producto Eliminado/Desconocido',
      productSku: productMap.get(m.product_id)?.sku || '---',
      staffName: m.staff_id ? (staffMap.get(m.staff_id)?.name || 'Desconocido') : 'Sistema',
    }));
  }, []);

  if (!historyData) {
    return <div className="p-8 text-center text-slate-400">Cargando historial...</div>;
  }

  if (historyData.length === 0) {
    return (
      <div className="p-12 text-center flex flex-col items-center text-slate-400">
        <History size={48} className="opacity-20 mb-4" />
        <p>No hay registros de movimientos en el inventario aún.</p>
      </div>
    );
  }

  // Formateador de fecha nativo (Sin librerías externas)
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs">
            <tr>
              <th className="p-4">Fecha / Hora</th>
              <th className="p-4">Producto</th>
              <th className="p-4">Usuario</th>
              <th className="p-4 text-center">Movimiento</th>
              <th className="p-4">Motivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {historyData.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="p-4 whitespace-nowrap text-slate-600 font-mono text-xs">
                  {formatDate(item.created_at)}
                </td>
                <td className="p-4">
                  <div className="font-bold text-slate-800">{item.productName}</div>
                  <div className="text-xs text-slate-400 font-mono">{item.productSku}</div>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2 text-slate-700">
                    <div className="w-6 h-6 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600">
                      <User size={12} />
                    </div>
                    <span className="text-xs font-medium">{item.staffName}</span>
                  </div>
                </td>
                <td className="p-4 text-center">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${
                      item.qty_change > 0
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {item.qty_change > 0 ? (
                      <ArrowUpRight size={12} />
                    ) : (
                      <ArrowDownLeft size={12} />
                    )}
                    {item.qty_change > 0 ? '+' : ''}
                    {item.qty_change}
                  </span>
                </td>
                <td className="p-4">
                  <span className="text-slate-600 capitalize bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-xs">
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

// Helper para traducir motivos técnicos a lenguaje humano
function translateReason(reason: string) {
  const map: Record<string, string> = {
    'initial': 'Carga Inicial',
    'correction': 'Ajuste Manual',
    'sale': 'Venta',
    'restock': 'Reabastecimiento',
    'return': 'Devolución',
    'damage': 'Merma/Daño'
  };
  return map[reason] || reason;
}