import { useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import type { Sale, SaleItem } from '../lib/db';
import { Printer, X, User, Star } from 'lucide-react';

interface TicketModalProps {
  sale: Sale | null;
  onClose: () => void;
}

export function TicketModal({ sale, onClose }: TicketModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // 1. Cargar Configuración del Negocio
  const config = useLiveQuery(async () => {
    const businessId = localStorage.getItem('nexus_business_id');
    if (businessId) {
      return await db.settings.get(businessId);
    }
    return undefined;
  });
  
  if (!sale) return null;

  // 2. Calcular Puntos Ganados (Regla: 1 pto por cada $10)
  // Nota: Esto es visual. La lógica real de guardado ya ocurrió en PosPage.
  const pointsEarned = sale.customer_id ? Math.floor(sale.total / 10) : 0;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[9999] backdrop-blur-sm animate-in fade-in duration-200 print:p-0 print:block print:bg-white print:static">
      
      <div className="bg-white w-full max-w-[380px] shadow-2xl overflow-hidden relative rounded-2xl print:shadow-none print:w-full print:max-w-none print:rounded-none">
        
        {/* Decoración Visual (Solo pantalla) */}
        <div className="h-3 bg-indigo-600 w-full print:hidden"></div>

        {/* --- CONTENIDO DEL TICKET --- */}
        <div 
            ref={contentRef}
            className="p-6 text-slate-900 font-mono text-xs leading-relaxed max-h-[85vh] overflow-y-auto print:max-h-none print:overflow-visible print:h-auto print:p-0 print:m-0"
        >
          {/* 1. ENCABEZADO */}
          <div className="text-center mb-4">
            <h2 className="text-xl font-black uppercase tracking-wider mb-1">
               {config?.name || 'NEXUS POS'}
            </h2>
            {config?.address && <p className="text-[10px] text-slate-500 uppercase">{config.address}</p>}
            {config?.phone && <p className="text-[10px] text-slate-500">Tel: {config.phone}</p>}
            
            <div className="mt-4 pt-2 border-t border-dashed border-slate-300">
                <p className="flex justify-between">
                    <span>FECHA:</span> 
                    <span>{new Date(sale.date).toLocaleDateString()}</span>
                </p>
                <p className="flex justify-between">
                    <span>HORA:</span> 
                    <span>{new Date(sale.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </p>
                <p className="flex justify-between font-bold">
                    <span>TICKET:</span> 
                    <span>#{sale.id.slice(0, 8).toUpperCase()}</span>
                </p>
                <p className="flex justify-between">
                    <span>VENDEDOR:</span> 
                    <span className="uppercase">{sale.staff_name?.split(' ')[0] || 'Cajero'}</span>
                </p>
            </div>
          </div>

          {/* 2. CLIENTE (Si existe) */}
          {sale.customer_name && (
             <div className="mb-4 border border-slate-200 rounded p-2 bg-slate-50 print:border-black print:bg-transparent print:border-dashed">
                <div className="flex items-center gap-1 font-bold text-slate-700 print:text-black">
                    <User size={12} /> 
                    <span className="uppercase">{sale.customer_name}</span>
                </div>
                {pointsEarned > 0 && (
                    <div className="flex items-center gap-1 text-[10px] text-indigo-600 mt-1 font-bold print:text-black">
                        <Star size={10} fill="currentColor" />
                        <span>Has ganado +{pointsEarned} puntos</span>
                    </div>
                )}
             </div>
          )}

          {/* 3. ÍTEMS */}
          <table className="w-full mb-4 border-collapse">
            <thead>
                <tr className="border-b border-black text-left">
                    <th className="py-1 w-8">CANT</th>
                    <th className="py-1">DESC</th>
                    <th className="py-1 text-right">TOTAL</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-dashed divide-slate-300">
                {sale.items.map((item: SaleItem, index: number) => (
                <tr key={index}>
                    <td className="py-2 align-top font-bold">{item.quantity}</td>
                    <td className="py-2 align-top pr-2">
                        <div className="uppercase">{item.name}</div>
                        {item.quantity > 1 && (
                            <div className="text-[10px] text-slate-500 print:text-black">
                                {item.quantity} x ${item.price.toFixed(2)}
                            </div>
                        )}
                    </td>
                    <td className="py-2 align-top text-right font-bold">
                        ${(item.price * item.quantity).toFixed(2)}
                    </td>
                </tr>
                ))}
            </tbody>
          </table>

          {/* 4. TOTALES */}
          <div className="border-t-2 border-black pt-2 mb-4 space-y-1">
            <div className="flex justify-between text-lg font-black">
                <span>TOTAL</span>
                <span>${sale.total.toFixed(2)}</span>
            </div>
            
            {/* Desglose de Pago */}
            <div className="pt-2 mt-2 border-t border-dashed border-slate-300 text-xs">
                <div className="flex justify-between">
                    <span>FORMA DE PAGO:</span>
                    <span className="uppercase font-bold">{sale.payment_method}</span>
                </div>
                {sale.payment_method === 'efectivo' && (
                    <>
                        <div className="flex justify-between">
                            <span>EFECTIVO:</span>
                            <span>${sale.amount_tendered?.toFixed(2) || sale.total.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between font-bold">
                            <span>CAMBIO:</span>
                            <span>${sale.change?.toFixed(2) || '0.00'}</span>
                        </div>
                    </>
                )}
            </div>
          </div>

          {/* 5. PIE DE PÁGINA */}
          <div className="text-center mt-6 pt-4 border-t border-slate-200">
            <p className="font-medium italic">"{config?.receipt_message || '¡Gracias por su compra!'}"</p>
            <p className="text-[9px] text-slate-400 mt-2 uppercase print:hidden">Powered by Nexus POS</p>
          </div>
        </div>

        {/* --- BOTONES DE ACCIÓN (No se imprimen) --- */}
        <div className="bg-slate-50 p-4 flex gap-3 border-t border-slate-200 print:hidden">
          <button 
            onClick={onClose}
            className="flex-1 bg-white border border-slate-300 text-slate-700 font-bold py-3 rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            <X size={18} /> Cerrar
          </button>
          <button 
            onClick={handlePrint} 
            autoFocus
            className="flex-1 bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-black transition-colors flex justify-center items-center gap-2 shadow-lg"
          >
            <Printer size={18} /> Imprimir (Enter)
          </button>
        </div>

      </div>

      {/* 🛡️ CSS ESPECIALIZADO PARA IMPRESORAS TÉRMICAS (58mm / 80mm) */}
      <style>{`
        @media print {
          @page { 
            margin: 0; 
            size: auto; 
          }
          
          body { 
            background: white; 
            margin: 0; 
            padding: 0; 
          }

          /* Ocultar todo lo que no sea el ticket */
          body * { 
            visibility: hidden; 
            height: 0;
            overflow: hidden; 
          }
          
          /* Hacer visible solo el contenedor del ticket */
          .fixed, .bg-white { 
            position: static !important; 
            width: 100% !important; 
            height: auto !important; 
            background: none !important; 
            box-shadow: none !important; 
            overflow: visible !important;
            display: block !important;
          }
          
          div[class*="overflow-y-auto"] { 
            visibility: visible !important; 
            height: auto !important;
            width: 100% !important;
            max-width: 100% !important; 
            position: absolute;
            left: 0;
            top: 0;
            padding: 10px !important; /* Margen seguro para impresora */
            margin: 0 !important; 
          }
          
          /* Asegurar que todos los hijos del ticket sean visibles y negros */
          div[class*="overflow-y-auto"] * { 
            visibility: visible !important; 
            height: auto !important;
            color: black !important; /* Impresoras térmicas solo imprimen negro */
          }

          /* Ocultar elementos decorativos */
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}