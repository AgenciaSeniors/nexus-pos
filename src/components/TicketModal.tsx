import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import type { Sale, SaleItem } from '../lib/db';

interface TicketModalProps {
  sale: Sale | null;
  onClose: () => void;
}

export function TicketModal({ sale, onClose }: TicketModalProps) {
  // ✅ CORRECCIÓN: Buscamos usando el ID real guardado en localStorage
  const config = useLiveQuery(async () => {
    const businessId = localStorage.getItem('nexus_business_id');
    if (businessId) {
      return await db.settings.get(businessId);
    }
    return undefined;
  });
  
  if (!sale) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white w-full max-w-sm shadow-2xl overflow-hidden relative">
        
        {/* Efecto de Papel (Top) */}
        <div className="h-2 bg-slate-800 w-full"></div>

        <div className="p-6 text-sm font-mono text-slate-800 max-h-[80vh] overflow-y-auto">
          {/* Header */}
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold uppercase tracking-wider mb-2">
               {config?.name || 'NEXUS POS'}
            </h2>
            <p className="text-xs text-slate-500">{config?.address}</p>
            <p className="text-xs text-slate-500">{config?.phone}</p>
            
            <p className="text-xs text-slate-500 mt-2">
              {new Date(sale.date).toLocaleString()}
            </p>
            <p className="text-xs text-slate-400 mt-1">Ticket #: {sale.id.slice(0, 8)}</p>
          </div>

          <div className="border-b-2 border-dashed border-slate-300 my-4"></div>

          {/* Items */}
          <div className="space-y-2 mb-4">
            {sale.items.map((item: SaleItem, index: number) => (
              <div key={index} className="flex justify-between items-start">
                <div>
                  <span className="font-bold">{item.quantity}x</span> {item.name}
                </div>
                <div className="text-right">
                  ${(item.price * item.quantity).toFixed(2)}
                </div>
              </div>
            ))}
          </div>

          <div className="border-b-2 border-dashed border-slate-300 my-4"></div>

          {/* Totales */}
          <div className="flex justify-between items-center text-lg font-bold mb-4">
            <span>TOTAL</span>
            <span>${sale.total.toFixed(2)}</span>
          </div>

          {/* --- INFORMACIÓN DE PAGO --- */}
          <div className="bg-slate-50 p-3 rounded mb-6 text-xs space-y-1">
             <div className="flex justify-between">
                <span className="text-slate-500">Método de Pago:</span>
                <span className="uppercase font-bold">{sale.payment_method}</span>
             </div>
             {sale.payment_method === 'efectivo' && (
               <>
                 <div className="flex justify-between">
                    <span className="text-slate-500">Recibido:</span>
                    <span>${sale.amount_tendered?.toFixed(2)}</span>
                 </div>
                 <div className="flex justify-between font-bold text-slate-800 pt-1 border-t border-slate-200 mt-1">
                    <span>Cambio / Vuelto:</span>
                    <span>${sale.change?.toFixed(2)}</span>
                 </div>
               </>
             )}
          </div>

          {/* Footer */}
          <div className="text-center text-xs text-slate-400 space-y-1">
            <p>{config?.receipt_message || 'Gracias por su preferencia'}</p>
            <p>nexus-pos.com</p>
          </div>
        </div>

        {/* Botones */}
        <div className="bg-slate-50 p-4 flex gap-2 border-t border-slate-100">
          <button 
            onClick={onClose}
            className="flex-1 bg-slate-200 text-slate-700 font-bold py-2 rounded hover:bg-slate-300 transition-colors"
          >
            Cerrar
          </button>
          <button 
            onClick={() => window.print()} 
            className="flex-1 bg-indigo-600 text-white font-bold py-2 rounded hover:bg-indigo-700 transition-colors flex justify-center items-center gap-2"
          >
            🖨️ Imprimir
          </button>
        </div>

      </div>
    </div>
  );
}