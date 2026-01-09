import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ParkedOrder } from '../lib/db';
import { PlayCircle, Trash2, Clock, X } from 'lucide-react';

interface Props {
  onRestore: (order: ParkedOrder) => void;
  onClose: () => void;
}

export function ParkedOrdersModal({ onRestore, onClose }: Props) {
  const orders = useLiveQuery(() => db.parked_orders.reverse().toArray()) || [];

  const handleDelete = (id: string) => {
    if (confirm('¿Borrar esta orden guardada?')) {
      db.parked_orders.delete(id);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        
        <div className="bg-slate-900 p-4 text-white flex justify-between items-center">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Clock size={20} className="text-orange-400" />
            Cuentas en Espera
          </h2>
          <button onClick={onClose}><X /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
          {orders.length === 0 && (
            <div className="text-center py-10 text-slate-400">
              No hay cuentas pendientes.
            </div>
          )}

          {orders.map(order => (
            <div key={order.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex justify-between items-center hover:border-indigo-300 transition-colors">
              <div>
                <p className="font-bold text-slate-700 text-lg">
                   Total: ${order.total.toFixed(2)}
                </p>
                <p className="text-xs text-slate-400 font-mono mt-1">
                  {new Date(order.date).toLocaleTimeString()} • {order.items.length} productos
                </p>
                <div className="text-xs text-slate-500 mt-2 line-clamp-1">
                  {/* CORRECCIÓN: Quitamos ': any' porque TypeScript ya sabe el tipo */}
                  {order.items.map(i => i.name).join(', ')}
                </div>
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={() => handleDelete(order.id)}
                  className="p-3 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
                  title="Eliminar"
                >
                  <Trash2 size={20} />
                </button>
                <button 
                  onClick={() => onRestore(order)}
                  className="p-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-md flex items-center gap-2 font-bold text-sm"
                >
                  <PlayCircle size={18} />
                  Recuperar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}