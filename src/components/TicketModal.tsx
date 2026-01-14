import { useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import type { Sale, SaleItem } from '../lib/db';
import { Printer, X } from 'lucide-react'; // Asegúrate de tener instalado lucide-react

interface TicketModalProps {
  sale: Sale | null;
  onClose: () => void;
}

export function TicketModal({ sale, onClose }: TicketModalProps) {
  // Referencia para identificar el contenido imprimible
  const contentRef = useRef<HTMLDivElement>(null);

  // 1. Obtener configuración del negocio usando el ID correcto
  const config = useLiveQuery(async () => {
    const businessId = localStorage.getItem('nexus_business_id');
    if (businessId) {
      return await db.settings.get(businessId);
    }
    return undefined;
  });
  
  if (!sale) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    // Agregamos clases 'print:...' para controlar el comportamiento al imprimir
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm animate-fade-in print:p-0 print:block print:bg-white print:static print:z-[9999]">
      <div className="bg-white w-full max-w-sm shadow-2xl overflow-hidden relative print:shadow-none print:w-full print:max-w-none print:h-auto print:rounded-none">
        
        {/* Efecto de Papel (Solo visible en pantalla) */}
        <div className="h-2 bg-slate-800 w-full print:hidden"></div>

        {/* CONTENEDOR DEL TICKET */}
        {/* 'overflow-y-auto' permite scroll en pantalla, pero 'print:overflow-visible' lo quita al imprimir */}
        <div 
            ref={contentRef}
            className="p-6 text-sm font-mono text-slate-800 max-h-[80vh] overflow-y-auto print:max-h-none print:overflow-visible print:h-auto"
        >
          {/* Header */}
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold uppercase tracking-wider mb-2">
               {config?.name || 'NEXUS POS'}
            </h2>
            {config?.address && <p className="text-xs text-slate-500">{config.address}</p>}
            {config?.phone && <p className="text-xs text-slate-500">Tel: {config.phone}</p>}
            
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

          {/* Información de Pago */}
          <div className="bg-slate-50 p-3 rounded mb-6 text-xs space-y-1 print:bg-transparent print:p-0">
             <div className="flex justify-between">
                <span className="text-slate-500 print:text-black">Método:</span>
                <span className="uppercase font-bold">{sale.payment_method}</span>
             </div>
             {sale.payment_method === 'efectivo' && (
               <>
                 <div className="flex justify-between">
                    <span className="text-slate-500 print:text-black">Recibido:</span>
                    <span>${sale.amount_tendered?.toFixed(2)}</span>
                 </div>
                 <div className="flex justify-between font-bold text-slate-800 pt-1 border-t border-slate-200 mt-1 print:text-black print:border-black">
                    <span>Cambio:</span>
                    <span>${sale.change?.toFixed(2)}</span>
                 </div>
               </>
             )}
          </div>

          {/* Footer */}
          <div className="text-center text-xs text-slate-400 space-y-1 print:text-black">
            <p>{config?.receipt_message || 'Gracias por su preferencia'}</p>
            <p className="text-[10px] mt-2">Software: Nexus POS</p>
          </div>
        </div>

        {/* Botones (Ocultos al imprimir) */}
        <div className="bg-slate-50 p-4 flex gap-2 border-t border-slate-100 print:hidden">
          <button 
            onClick={onClose}
            className="flex-1 bg-slate-200 text-slate-700 font-bold py-2 rounded hover:bg-slate-300 transition-colors flex items-center justify-center gap-2"
          >
            <X size={18} /> Cerrar
          </button>
          <button 
            onClick={handlePrint} 
            className="flex-1 bg-indigo-600 text-white font-bold py-2 rounded hover:bg-indigo-700 transition-colors flex justify-center items-center gap-2"
          >
            <Printer size={18} /> Imprimir
          </button>
        </div>

      </div>

      {/* 🛡️ ESTILOS CRÍTICOS PARA IMPRESIÓN */}
      <style>{`
        @media print {
          @page { margin: 0; size: auto; }
          /* Ocultar todo lo que no sea el ticket */
          body * { visibility: hidden; }
          
          /* Hacer visible solo el contenedor del ticket y sus hijos */
          .fixed, .bg-white { position: static !important; width: 100% !important; height: auto !important; background: none !important; box-shadow: none !important; }
          
          /* Importante: Forzar visibilidad del contenido ref */
          div[class*="overflow-y-auto"] { 
            visibility: visible !important; 
            position: absolute !important; 
            left: 0 !important; 
            top: 0 !important; 
            width: 100% !important; 
            margin: 0 !important; 
            padding: 20px !important; 
            max-height: none !important; 
            overflow: visible !important; 
          }
          
          div[class*="overflow-y-auto"] * { visibility: visible !important; }
        }
      `}</style>
    </div>
  );
}