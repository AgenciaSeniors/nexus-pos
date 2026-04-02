import { useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import type { Sale, SaleItem, ParkedOrder } from '../lib/db';
import { Printer, X, User, Star } from 'lucide-react';
import { toast } from 'sonner';

interface TicketModalProps {
  sale?: Sale | null;
  order?: ParkedOrder | null; // ✅ AHORA ACEPTA ÓRDENES EN ESPERA
  onClose: () => void;
}

export function TicketModal({ sale, order, onClose }: TicketModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // 1. Cargar Configuración del Negocio
  const config = useLiveQuery(async () => {
    const businessId = localStorage.getItem('nexus_business_id');
    if (businessId) {
      return await db.settings.get(businessId);
    }
    return undefined;
  });
  
  // Detectar si estamos imprimiendo una Pre-cuenta o un Recibo Final
  const doc = sale || order;
  if (!doc) return null;
  const isPreBill = !!order;

  // 2. Calcular Puntos Ganados (Solo si es venta final, sobre el total final pagado)
  const pointsEarned = (!isPreBill && doc.customer_id) ? Math.floor(doc.total / 10) : 0;

  // Subtotal antes de descuento (suma de ítems)
  const itemsSubtotal = doc.items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  // Escuchar resultado de impresión en Electron y notificar al usuario
  useEffect(() => {
    if (!window.electronAPI?.onPrintResult) return;
    window.electronAPI.onPrintResult((success: boolean, errorType: string | null) => {
      if (success) {
        toast.success('Ticket enviado a la impresora');
      } else {
        toast.error(`Error al imprimir: ${errorType || 'impresora no disponible'}`);
      }
    });
  }, []);

  const handlePrint = () => {
    if (window.electronAPI) {
      window.electronAPI.printTicket();
    } else {
      window.print();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[9999] backdrop-blur-sm animate-in fade-in duration-200">
      
      {/* ✅ AÑADIDO id="printable-ticket" PARA EL MOTOR DE PDF */}
      <div id="printable-ticket" className="bg-white w-full max-w-[380px] shadow-2xl overflow-hidden relative rounded-2xl">
        
        {/* Decoración Visual (Si es pre-cuenta es naranja, si es final es azul) */}
        <div className={`h-3 w-full no-print ${isPreBill ? 'bg-orange-500' : 'bg-[#0B3B68]'}`}></div>

        {/* --- CONTENIDO DEL TICKET --- */}
        <div 
            ref={contentRef}
            className="p-6 text-slate-900 font-mono text-xs leading-relaxed max-h-[85vh] overflow-y-auto"
        >
          {/* 1. ENCABEZADO */}
          <div className="text-center mb-4">
            <h2 className="text-xl font-black uppercase tracking-wider mb-1">
               {config?.name || 'BISNE CON TALLA'}
            </h2>
            {config?.address && <p className="text-[10px] text-slate-500 uppercase">{config.address}</p>}
            {config?.phone && <p className="text-[10px] text-slate-500">Tel: {config.phone}</p>}
            
            <div className="mt-4 pt-2 border-t border-dashed border-slate-300">
                <p className="flex justify-between">
                    <span>FECHA:</span> 
                    <span>{new Date(doc.date).toLocaleDateString()}</span>
                </p>
                <p className="flex justify-between">
                    <span>HORA:</span> 
                    <span>{new Date(doc.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </p>
                <p className="flex justify-between font-bold">
                    <span>{isPreBill ? 'PRE-CUENTA:' : 'TICKET:'}</span> 
                    <span>#{doc.id.slice(0, 8).toUpperCase()}</span>
                </p>
                
                {/* MOSTRAR MESA O NOTA SI ES UNA PRE-CUENTA */}
                {isPreBill && order?.note && (
                  <p className="flex justify-between font-black text-sm mt-1 bg-gray-100 p-1 rounded">
                      <span>MESA / REF:</span> 
                      <span className="uppercase">{order.note}</span>
                  </p>
                )}
                
                {/* MOSTRAR CAJERO SOLO EN RECIBO FINAL */}
                {!isPreBill && sale?.staff_name && (
                  <p className="flex justify-between">
                      <span>VENDEDOR:</span> 
                      <span className="uppercase">{sale.staff_name.split(' ')[0] || 'Cajero'}</span>
                  </p>
                )}
            </div>
          </div>

          {/* 2. CLIENTE (Si existe) */}
          {doc.customer_name && (
             <div className="mb-4 border border-slate-200 rounded p-2 bg-slate-50">
                <div className="flex items-center gap-1 font-bold text-slate-700">
                    <User size={12} /> 
                    <span className="uppercase">{doc.customer_name}</span>
                </div>
                {pointsEarned > 0 && (
                    <div className="flex items-center gap-1 text-[10px] text-indigo-600 mt-1 font-bold">
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
                {doc.items.map((item: SaleItem, index: number) => (
                <tr key={index}>
                    <td className="py-2 align-top font-bold">{item.quantity}</td>
                    <td className="py-2 align-top pr-2">
                        <div className="uppercase">{item.name}</div>
                        {item.note && (
                            <div className="text-[10px] text-slate-600 italic mt-0.5">↳ {item.note}</div>
                        )}
                        {item.quantity > 1 && (
                            <div className="text-[10px] text-slate-500">
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
            {/* Subtotal si hay descuento o puntos */}
            {!isPreBill && sale && (sale.discount_amount || sale.redeemed_points) ? (
              <div className="flex justify-between text-xs">
                <span>SUBTOTAL</span>
                <span>${itemsSubtotal.toFixed(2)}</span>
              </div>
            ) : null}

            {/* Descuento */}
            {!isPreBill && sale?.discount_amount && sale.discount_amount > 0 && (
              <div className="flex justify-between text-xs text-slate-600">
                <span>DESCUENTO{sale.discount_type === 'percentage' && sale.discount_input ? ` (${sale.discount_input}%)` : ''}</span>
                <span>-${sale.discount_amount.toFixed(2)}</span>
              </div>
            )}

            {/* Puntos canjeados */}
            {!isPreBill && sale?.redeemed_points && sale.redeemed_points > 0 && (
              <div className="flex justify-between text-xs text-indigo-600 font-bold">
                <span>PUNTOS CANJEADOS ({sale.redeemed_points} pts)</span>
                <span>-${(sale.redeemed_points * 0.10).toFixed(2)}</span>
              </div>
            )}

            <div className="flex justify-between text-lg font-black border-t border-dashed border-slate-300 pt-1 mt-1">
                <span>TOTAL</span>
                <span>${doc.total.toFixed(2)}</span>
            </div>

            {/* Desglose de Pago (SOLO SI ES VENTA FINAL) */}
            {!isPreBill && sale && (
                <div className="pt-2 mt-1 border-t border-dashed border-slate-300 text-xs">
                    {sale.payment_method === 'mixto' ? (
                      <>
                        <div className="flex justify-between font-bold">
                          <span>FORMA DE PAGO:</span>
                          <span>MIXTO</span>
                        </div>
                        <div className="flex justify-between">
                          <span>EFECTIVO:</span>
                          <span>${(sale.cash_amount || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>TRANSFERENCIA:</span>
                          <span>${(sale.transfer_amount || 0).toFixed(2)}</span>
                        </div>
                      </>
                    ) : (
                      <>
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
                      </>
                    )}
                </div>
            )}

            {/* ITEMS DEVUELTOS */}
            {!isPreBill && sale?.refunded_items && sale.refunded_items.length > 0 && (
              <div className="pt-2 mt-2 border-t border-dashed border-red-300 text-xs">
                <p className="font-black text-red-600 text-center mb-1">DEVOLUCIONES</p>
                {sale.refunded_items.map((ri, idx) => (
                  <div key={idx} className="flex justify-between text-red-600">
                    <span>{ri.quantity}x {ri.name}</span>
                    <span>-${ri.amount.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ADVERTENCIA SI ES PRE-CUENTA */}
            {isPreBill && (
                 <div className="pt-3 mt-3 border-t border-dashed border-slate-300 text-[10px] text-center font-bold">
                    *** DOCUMENTO NO VÁLIDO COMO FACTURA ***<br/>
                    SOLICITE SU RECIBO AL PAGAR
                 </div>
            )}
          </div>

          {/* 5. PIE DE PÁGINA */}
          <div className="text-center mt-6 pt-4 border-t border-slate-200">
            <p className="font-medium italic">"{config?.receipt_message || '¡Gracias por su compra!'}"</p>
            <p className="text-[9px] text-slate-400 mt-2 uppercase no-print">Powered by Agencia Señores</p>
          </div>
        </div>

        {/* --- BOTONES DE ACCIÓN (Clase no-print para que no salgan en el PDF) --- */}
        <div className="bg-slate-50 p-4 flex gap-3 border-t border-slate-200 no-print">
          <button 
            onClick={onClose}
            className="flex-1 bg-white border border-slate-300 text-slate-700 font-bold py-3 rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            <X size={18} /> Cerrar
          </button>
          <button 
            onClick={handlePrint} 
            autoFocus
            className={`flex-1 text-white font-bold py-3 rounded-xl transition-colors flex justify-center items-center gap-2 shadow-lg ${isPreBill ? 'bg-orange-500 hover:bg-orange-600' : 'bg-[#0B3B68] hover:bg-[#0B3B68]/90'}`}
          >
            <Printer size={18} /> Imprimir / PDF
          </button>
        </div>

      </div>

      {/* ✅ CSS DE IMPRESIÓN SEGURO PARA EXPORTAR A PDF */}
      <style>{`
        @media print {
          @page { 
            margin: 5mm; 
          }
          body { 
            background: white !important; 
            -webkit-print-color-adjust: exact; 
            print-color-adjust: exact; 
          }
          
          /* Oculta toda la app de fondo */
          body * { 
            visibility: hidden; 
          }
          
          /* Muestra SOLO el ticket */
          #printable-ticket, #printable-ticket * { 
            visibility: visible; 
          }
          
          /* Posiciona el ticket arriba a la izquierda como si fuera la página principal para que no se corte */
          #printable-ticket { 
            position: absolute; 
            left: 0; 
            top: 0; 
            width: 100%; 
            margin: 0; 
            padding: 0;
            box-shadow: none !important;
            border-radius: 0 !important;
          }

          /* Oculta forzosamente los botones y elementos innecesarios */
          .no-print, .no-print * { 
            display: none !important; 
          }
          
          /* Corrige el scroll para que el PDF renderice todo el largo del ticket y no solo lo que se ve en pantalla */
          div[class*="overflow-y-auto"] {
             overflow: visible !important;
             max-height: none !important;
          }
        }
      `}</style>
    </div>
  );
}