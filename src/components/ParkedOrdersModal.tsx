import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ParkedOrder } from '../lib/db';
import { PlayCircle, Trash2, Clock, X, UserSquare2, Printer } from 'lucide-react';
import { TicketModal } from './TicketModal';

interface Props {
  onRestore: (order: ParkedOrder) => void;
  onClose: () => void;
}

export function ParkedOrdersModal({ onRestore, onClose }: Props) {
  const orders = useLiveQuery(() => db.parked_orders.reverse().toArray()) || [];

  const formatOrderTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return time;
    return `${d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${time}`;
  };
  
  // ✅ ESTADO PARA SABER QUÉ ORDEN ESTAMOS IMPRIMIENDO
  const [orderToPrint, setOrderToPrint] = useState<ParkedOrder | null>(null);

  const handleDelete = (id: string) => {
    if (confirm('¿Borrar esta orden guardada?')) {
      db.parked_orders.delete(id);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
        <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
          
          <div className="bg-[#0B3B68] p-4 text-white flex justify-between items-center">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <Clock size={20} className="text-orange-400" />
              Cuentas en Espera
            </h2>
            <button onClick={onClose} className="hover:text-red-400 transition-colors"><X /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {orders.length === 0 && (
              <div className="text-center py-10 text-slate-400">
                No hay cuentas pendientes.
              </div>
            )}

            {orders.map(order => (
              <div key={order.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex justify-between items-center hover:border-[#0B3B68]/30 transition-colors">
                <div>
                  {order.note && (
                    <div className="inline-flex items-center gap-1.5 bg-orange-100 text-orange-700 px-2.5 py-1 rounded-md text-xs font-black uppercase mb-2 border border-orange-200 tracking-wide">
                      <UserSquare2 size={12} />
                      {order.note}
                    </div>
                  )}
                  
                  <p className="font-bold text-slate-700 text-lg">
                     Total: ${order.total.toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-400 font-mono mt-1">
                    <Clock size={10} className="inline mr-1 opacity-60"/>{formatOrderTime(order.date)} • {order.items.length} productos
                  </p>
                  <div className="text-xs text-slate-500 mt-2 line-clamp-1">
                    {order.items.map(i => i.name).join(', ')}
                  </div>
                </div>

                <div className="flex gap-2 pl-4">
                  {/* ✅ NUEVO BOTÓN DE IMPRESIÓN */}
                  <button 
                    onClick={() => setOrderToPrint(order)}
                    className="p-3 text-slate-500 hover:text-[#0B3B68] hover:bg-[#0B3B68]/10 rounded-lg transition-colors"
                    title="Imprimir Pre-cuenta"
                  >
                    <Printer size={20} />
                  </button>
                  <button 
                    onClick={() => handleDelete(order.id)}
                    className="p-3 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Eliminar"
                  >
                    <Trash2 size={20} />
                  </button>
                  <button 
                    onClick={() => onRestore(order)}
                    className="p-3 bg-[#0B3B68] text-white rounded-lg hover:bg-[#0B3B68]/90 shadow-md flex items-center gap-2 font-bold text-sm transition-transform active:scale-95"
                  >
                    <PlayCircle size={18} />
                    <span className="hidden sm:inline">Cobrar</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ✅ RENDERIZA EL TICKET POR ENCIMA DEL MODAL DE ÓRDENES */}
      {orderToPrint && (
          <TicketModal 
              order={orderToPrint} 
              onClose={() => setOrderToPrint(null)} 
          />
      )}
    </>
  );
}