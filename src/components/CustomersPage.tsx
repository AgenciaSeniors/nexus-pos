import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { db, type Customer, type Staff} from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { 
    UserPlus, Search, Edit2, Trash2, Users, Loader2, Phone, Mail, MapPin, 
    Star, Gift, History, X, TrendingUp, Calendar, ChevronRight
} from 'lucide-react';
import { toast } from 'sonner';
import { addToQueue, syncPush } from '../lib/sync';
import { logAuditAction } from '../lib/audit';
import { currency } from '../lib/currency';

export function CustomersPage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id');

  // ESTADOS
  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false); // Modal CRM
  const [isPointsModalOpen, setIsPointsModalOpen] = useState(false); // Modal Puntos
  
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // FORMULARIO CLIENTE
  const [formData, setFormData] = useState({ name: '', phone: '', email: '', address: '' });
  
  // FORMULARIO PUNTOS
  const [pointsAdjustment, setPointsAdjustment] = useState({ amount: 0, reason: '' });

  // --- CONSULTAS ---
  const customers = useLiveQuery(async () => {
    if (!businessId) return [];
    return await db.customers
      .where('business_id').equals(businessId)
      .filter(c => !c.deleted_at)
      .reverse()
      .sortBy('created_at');
  }, [businessId]) || [];

  // Historial de ventas del cliente seleccionado
  const customerHistory = useLiveQuery(async () => {
      if (!selectedCustomer) return { sales: [], totalSpent: 0, lastVisit: null };
      
      const sales = await db.sales
        .where('customer_id').equals(selectedCustomer.id)
        .reverse()
        .sortBy('date');
        
      const totalSpent = sales.reduce((sum, s) => sum + s.total, 0);
      const lastVisit = sales.length > 0 ? sales[0].date : null;

      return { sales, totalSpent, lastVisit };
  }, [selectedCustomer]);

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.phone && c.phone.includes(searchTerm))
  );

  // --- LÓGICA DE CLIENTES (Crear/Editar) ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;
    
    setIsLoading(true);
    try {
        const cleanName = formData.name.trim();
        const cleanPhone = formData.phone.trim();
        
        if (!cleanName) {
            setIsLoading(false);
            return toast.warning("El nombre es obligatorio");
        }

        // Validación duplicados
        if (cleanPhone) {
            const duplicate = await db.customers
                .where({ business_id: businessId })
                .filter(c => c.phone === cleanPhone && !c.deleted_at)
                .first();
            
            if (duplicate && duplicate.id !== editingId) {
                toast.warning(`El teléfono ${cleanPhone} ya pertenece a "${duplicate.name}"`);
                setIsLoading(false);
                return;
            }
        }

        const customerData = {
            name: cleanName,
            phone: cleanPhone || undefined,
            email: formData.email.trim() || undefined,
            address: formData.address.trim() || undefined
        };

        await db.transaction('rw', [db.customers, db.action_queue, db.audit_logs], async () => {
            if (editingId) {
                const original = await db.customers.get(editingId);
                if (!original) throw new Error("Cliente no encontrado");

                const updated = { ...original, ...customerData, sync_status: 'pending_update' as const, updated_at: new Date().toISOString() };
                await db.customers.put(updated);
                await addToQueue('CUSTOMER_SYNC', updated);
                await logAuditAction('UPDATE_CUSTOMER', { name: updated.name }, currentStaff);
                toast.success("Cliente actualizado");
            } else {
                const newCustomer: Customer = {
                    id: crypto.randomUUID(),
                    business_id: businessId,
                    ...customerData,
                    loyalty_points: 0,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    sync_status: 'pending_create' as const
                };
                await db.customers.add(newCustomer);
                await addToQueue('CUSTOMER_SYNC', newCustomer);
                await logAuditAction('CREATE_CUSTOMER', { name: newCustomer.name }, currentStaff);
                toast.success("Cliente registrado");
            }
        });

        setIsFormOpen(false);
        resetForm();
        syncPush().catch(console.error);

    } catch (error) {
        console.error(error);
        toast.error("Error al guardar");
    } finally {
        setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar cliente? Se mantendrá su historial de ventas pero no podrá asignarse a nuevas.')) return;
    try {
        const customer = await db.customers.get(id);
        if (!customer) return;

        const deleted = { ...customer, deleted_at: new Date().toISOString(), sync_status: 'pending_update' as const };
        
        await db.transaction('rw', [db.customers, db.action_queue, db.audit_logs], async () => {
            await db.customers.put(deleted);
            await addToQueue('CUSTOMER_SYNC', deleted);
            await logAuditAction('DELETE_CUSTOMER', { name: customer.name }, currentStaff);
        });
        
        toast.success("Cliente eliminado");
        if (selectedCustomer?.id === id) setSelectedCustomer(null);
        syncPush().catch(console.error);
    } catch (e) {console.error(e); toast.error("Error al eliminar"); }
  };

  // --- LÓGICA DE PUNTOS (Ajuste Manual) ---
  const handlePointsAdjustment = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedCustomer || pointsAdjustment.amount === 0) return;
      if (!pointsAdjustment.reason.trim()) return toast.warning("Debes indicar un motivo");

      setIsLoading(true);
      try {
          const currentPoints = selectedCustomer.loyalty_points || 0;
          const newPoints = Math.max(0, currentPoints + pointsAdjustment.amount); // No permitir negativos totales

          const updatedCustomer = {
              ...selectedCustomer,
              loyalty_points: newPoints,
              sync_status: 'pending_update' as const,
              updated_at: new Date().toISOString()
          };

          await db.transaction('rw', [db.customers, db.action_queue, db.audit_logs], async () => {
              await db.customers.put(updatedCustomer);
              await addToQueue('CUSTOMER_SYNC', updatedCustomer);
              // NOTA: Asegúrate que 'UPDATE_LOYALTY' esté en tu AuditLog type en db.ts
              await logAuditAction('UPDATE_LOYALTY', { 
                  customer: selectedCustomer.name, 
                  adjustment: pointsAdjustment.amount, 
                  reason: pointsAdjustment.reason,
                  old_balance: currentPoints,
                  new_balance: newPoints
              }, currentStaff);
          });

          setSelectedCustomer(updatedCustomer); // Actualizar vista local
          setIsPointsModalOpen(false);
          setPointsAdjustment({ amount: 0, reason: '' });
          toast.success(`Puntos actualizados: ${newPoints} pts`);
          syncPush().catch(console.error);

      } catch (error) {
          console.error(error);
          toast.error("Error al ajustar puntos");
      } finally {
          setIsLoading(false);
      }
  };

  // --- UTILS ---
  const openEdit = (c: Customer) => {
      setEditingId(c.id);
      setFormData({ name: c.name, phone: c.phone || '', email: c.email || '', address: c.address || '' });
      setIsFormOpen(true);
  };

  const openDetails = (c: Customer) => {
      setSelectedCustomer(c);
      setIsDetailsOpen(true);
  };

  const resetForm = () => {
      setFormData({ name: '', phone: '', email: '', address: '' });
      setEditingId(null);
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto pb-24">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
        <div>
            <h1 className="text-2xl font-bold text-[#0B3B68] flex items-center gap-2">
                <Users className="text-[#7AC142]" /> Clientes
            </h1>
            <p className="text-[#6B7280] text-sm">Fidelización y contactos</p>
        </div>
        
        <div className="flex w-full sm:w-auto gap-2">
            <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280] w-4 h-4" />
                <input 
                    type="text" 
                    placeholder="Buscar..." 
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B3B68] outline-none shadow-sm text-[#1F2937]"
                />
            </div>
            <button 
                onClick={() => { resetForm(); setIsFormOpen(true); }}
                className="bg-[#7AC142] hover:bg-[#7AC142]/90 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-bold shadow-lg shadow-[#7AC142]/20 transition-colors"
            >
                <UserPlus size={18} /> <span className="hidden sm:inline">Nuevo</span>
            </button>
        </div>
      </div>

      {/* LISTA */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-in fade-in duration-300">
        {!customers ? (
             <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-[#0B3B68]"/></div>
        ) : filteredCustomers.length === 0 ? (
            <div className="p-12 text-center text-[#6B7280]">
                <Users size={32} className="mx-auto mb-3 opacity-20"/>
                <p>No se encontraron clientes.</p>
            </div>
        ) : (
            <div className="overflow-x-auto">
                <table className="mobile-card-table w-full text-left">
                    <thead className="bg-[#F3F4F6] text-[#6B7280] uppercase text-xs font-bold border-b border-gray-100">
                        <tr>
                            <th className="p-4">Cliente</th>
                            <th className="p-4">Contacto</th>
                            <th className="p-4 text-center">Fidelidad</th>
                            <th className="p-4 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {filteredCustomers.map(c => (
                            <tr key={c.id} className="hover:bg-gray-50 transition-colors group cursor-pointer" onClick={() => openDetails(c)}>
                                <td className="p-4" data-label="Cliente">
                                    <div className="text-right md:text-left">
                                        <div className="font-bold text-[#1F2937]">{c.name}</div>
                                        <div className="text-xs text-[#6B7280]">Desde: {new Date(c.created_at || Date.now()).toLocaleDateString()}</div>
                                    </div>
                                </td>
                                <td className="p-4 text-sm text-[#6B7280]" data-label="Contacto">
                                    <div className="flex flex-col items-end md:items-start">
                                        {c.phone && <div className="flex items-center gap-2 mb-1"><Phone size={14} className="text-[#0B3B68]"/> {c.phone}</div>}
                                        {c.email && <div className="flex items-center gap-2"><Mail size={14} className="text-[#0B3B68]"/> {c.email}</div>}
                                    </div>
                                </td>
                                <td className="p-4 text-center" data-label="Puntos">
                                    <div className="flex justify-end md:justify-center w-full">
                                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border ${c.loyalty_points && c.loyalty_points > 0 ? 'bg-[#7AC142]/10 text-[#7AC142] border-[#7AC142]/20' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>
                                            <Star size={12} className={c.loyalty_points ? 'fill-current' : ''}/> {c.loyalty_points || 0}
                                        </span>
                                    </div>
                                </td>
                                <td className="p-4 text-right" data-label="Acciones" onClick={e => e.stopPropagation()}>
                                    <div className="flex justify-end gap-2 w-full">
                                        <button onClick={() => openEdit(c)} className="p-2 text-[#6B7280] hover:text-[#0B3B68] hover:bg-[#0B3B68]/5 rounded-lg transition-colors"><Edit2 size={18}/></button>
                                        <button onClick={() => handleDelete(c.id)} className="p-2 text-[#6B7280] hover:text-[#EF4444] hover:bg-[#EF4444]/10 rounded-lg transition-colors"><Trash2 size={18}/></button>
                                        <button onClick={() => openDetails(c)} className="p-2 text-[#6B7280] hover:text-[#0B3B68] hover:bg-gray-100 rounded-lg"><ChevronRight size={18}/></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
      </div>

      {/* --- MODAL DETALLES (CRM) --- */}
      {isDetailsOpen && selectedCustomer && (
          <div className="fixed inset-0 bg-[#0B3B68]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden">
                  
                  {/* Header del Modal */}
                  <div className="p-6 bg-[#F3F4F6] border-b border-gray-200 flex justify-between items-start">
                      <div className="flex items-center gap-4">
                          <div className="w-16 h-16 bg-[#0B3B68] rounded-full flex items-center justify-center text-white font-bold text-2xl shadow-lg border-2 border-white">
                              {selectedCustomer.name.substring(0,2).toUpperCase()}
                          </div>
                          <div>
                              <h2 className="text-2xl font-bold text-[#1F2937]">{selectedCustomer.name}</h2>
                              <div className="flex gap-4 text-sm text-[#6B7280] mt-1">
                                  {selectedCustomer.phone && <span className="flex items-center gap-1"><Phone size={14}/> {selectedCustomer.phone}</span>}
                                  {selectedCustomer.email && <span className="flex items-center gap-1"><Mail size={14}/> {selectedCustomer.email}</span>}
                              </div>
                              {selectedCustomer.address && <p className="text-xs text-[#6B7280] mt-1 flex items-center gap-1"><MapPin size={12}/> {selectedCustomer.address}</p>}
                          </div>
                      </div>
                      <button onClick={() => setIsDetailsOpen(false)} className="p-2 hover:bg-gray-200 rounded-full text-[#6B7280]"><X size={24}/></button>
                  </div>

                  {/* Contenido */}
                  <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                      
                      {/* Sidebar: Estadísticas y Puntos */}
                      <div className="w-full md:w-1/3 bg-[#F3F4F6] border-r border-gray-200 p-6 flex flex-col gap-6 overflow-y-auto">
                          
                          {/* Tarjeta de Puntos */}
                          <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#F59E0B]/20 relative overflow-hidden">
                              <div className="absolute top-0 right-0 p-4 opacity-10"><Star size={100} className="text-[#F59E0B]"/></div>
                              <p className="text-[#6B7280] text-xs font-bold uppercase tracking-wider">Puntos Fidelidad</p>
                              <h3 className="text-4xl font-black text-[#1F2937] mt-1">{selectedCustomer.loyalty_points || 0}</h3>
                              <button 
                                onClick={() => setIsPointsModalOpen(true)}
                                className="mt-4 w-full py-2 bg-[#0B3B68] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-[#0B3B68]/90 transition-colors"
                              >
                                  <Gift size={14}/> Ajustar Saldo
                              </button>
                          </div>

                          {/* Estadísticas */}
                          <div className="space-y-4">
                              <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200">
                                  <div className="bg-[#7AC142]/10 p-2 rounded-lg text-[#7AC142]"><TrendingUp size={20}/></div>
                                  <div>
                                      <p className="text-[10px] text-[#6B7280] font-bold uppercase">Total Gastado</p>
                                      <p className="font-bold text-[#1F2937]">{currency.format(customerHistory?.totalSpent || 0)}</p>
                                  </div>
                              </div>
                              <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200">
                                  <div className="bg-[#0B3B68]/10 p-2 rounded-lg text-[#0B3B68]"><Calendar size={20}/></div>
                                  <div>
                                      <p className="text-[10px] text-[#6B7280] font-bold uppercase">Última Visita</p>
                                      <p className="font-bold text-[#1F2937]">{customerHistory?.lastVisit ? new Date(customerHistory.lastVisit).toLocaleDateString() : 'N/A'}</p>
                                  </div>
                              </div>
                          </div>
                      </div>

                      {/* Main: Historial de Compras */}
                      <div className="flex-1 bg-white flex flex-col min-h-0">
                          <div className="p-4 border-b border-gray-100 font-bold text-[#1F2937] flex items-center gap-2">
                              <History size={18} className="text-[#6B7280]"/> Historial de Compras
                          </div>
                          <div className="flex-1 overflow-y-auto p-0">
                              {customerHistory?.sales && customerHistory.sales.length > 0 ? (
                                  <table className="w-full text-sm text-left">
                                      <thead className="bg-[#F3F4F6] text-[#6B7280] uppercase text-xs sticky top-0">
                                          <tr>
                                              <th className="p-4">Fecha</th>
                                              <th className="p-4">Productos</th>
                                              <th className="p-4 text-right">Total</th>
                                          </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                          {customerHistory.sales.map(sale => (
                                              <tr key={sale.id} className="hover:bg-gray-50">
                                                  <td className="p-4 align-top whitespace-nowrap text-[#6B7280] text-xs">
                                                      {new Date(sale.date).toLocaleDateString()} <br/>
                                                      <span className="text-[10px] opacity-70">{new Date(sale.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                                  </td>
                                                  <td className="p-4 align-top">
                                                      <ul className="space-y-1">
                                                          {sale.items.map((item, idx) => (
                                                              <li key={idx} className="text-xs text-[#1F2937]">
                                                                  <span className="font-bold">{item.quantity}x</span> {item.name}
                                                              </li>
                                                          ))}
                                                      </ul>
                                                  </td>
                                                  <td className="p-4 align-top text-right font-bold text-[#1F2937]">
                                                      {currency.format(sale.total)}
                                                  </td>
                                              </tr>
                                          ))}
                                      </tbody>
                                  </table>
                              ) : (
                                  <div className="p-12 text-center text-[#6B7280] italic">No hay historial de compras.</div>
                              )}
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* --- MODAL AJUSTE PUNTOS --- */}
      {isPointsModalOpen && selectedCustomer && (
          <div className="fixed inset-0 bg-[#0B3B68]/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
                  <div className="p-5 border-b border-gray-100 bg-[#F3F4F6] text-center">
                      <h3 className="font-bold text-[#1F2937]">Ajustar Puntos</h3>
                      <p className="text-xs text-[#6B7280]">Saldo actual: <span className="font-bold">{selectedCustomer.loyalty_points || 0}</span></p>
                  </div>
                  <form onSubmit={handlePointsAdjustment} className="p-6 space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-[#6B7280] uppercase mb-2">Cantidad a ajustar (+/-)</label>
                          <div className="flex gap-2">
                              <button type="button" onClick={() => setPointsAdjustment(p => ({...p, amount: p.amount - 10}))} className="p-2 bg-[#EF4444]/10 text-[#EF4444] rounded-lg font-bold border border-[#EF4444]/20 hover:bg-[#EF4444]/20">-10</button>
                              <input 
                                type="number" autoFocus
                                className="flex-1 text-center font-bold text-xl border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#0B3B68]"
                                value={pointsAdjustment.amount}
                                onChange={e => setPointsAdjustment(p => ({...p, amount: parseInt(e.target.value) || 0}))}
                              />
                              <button type="button" onClick={() => setPointsAdjustment(p => ({...p, amount: p.amount + 10}))} className="p-2 bg-[#7AC142]/10 text-[#7AC142] rounded-lg font-bold border border-[#7AC142]/20 hover:bg-[#7AC142]/20">+10</button>
                          </div>
                          <p className="text-xs text-center mt-2 text-[#6B7280]">
                              Nuevo saldo: <span className="font-bold text-[#0B3B68]">{Math.max(0, (selectedCustomer.loyalty_points || 0) + pointsAdjustment.amount)}</span>
                          </p>
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Motivo (Obligatorio)</label>
                          <input 
                            type="text" required
                            className="w-full p-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-[#0B3B68]"
                            placeholder="Ej. Regalo cumpleaños, Error..."
                            value={pointsAdjustment.reason}
                            onChange={e => setPointsAdjustment(p => ({...p, reason: e.target.value}))}
                          />
                      </div>
                      <div className="flex gap-2 pt-2">
                          <button type="button" onClick={() => setIsPointsModalOpen(false)} className="flex-1 py-2 text-[#6B7280] font-bold hover:bg-gray-50 rounded-lg">Cancelar</button>
                          <button type="submit" disabled={isLoading} className="flex-1 py-2 bg-[#0B3B68] text-white font-bold rounded-lg hover:bg-[#0B3B68]/90">
                              {isLoading ? <Loader2 className="animate-spin mx-auto"/> : 'Confirmar'}
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {/* --- MODAL FORMULARIO CLIENTE --- */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-[#0B3B68]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
                <div className="p-6 border-b border-gray-100 bg-[#F3F4F6] flex justify-between items-center">
                    <h2 className="text-xl font-bold text-[#1F2937]">{editingId ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
                    <button onClick={() => setIsFormOpen(false)} className="text-[#6B7280] hover:text-[#1F2937] text-2xl leading-none">&times;</button>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Nombre Completo <span className="text-[#EF4444]">*</span></label>
                        <input autoFocus required type="text" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none"
                            value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Ej. Juan Pérez" />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Teléfono</label>
                            <input type="tel" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none"
                                value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="Ej. 555-1234" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Email</label>
                            <input type="email" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none"
                                value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="juan@mail.com" />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Dirección</label>
                        <input type="text" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none"
                            value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="Calle Principal #123..." />
                    </div>
                    
                    <div className="flex gap-3 pt-4">
                        <button type="button" onClick={() => setIsFormOpen(false)} className="flex-1 py-3 bg-white border border-[#0B3B68] text-[#0B3B68] font-bold rounded-xl hover:bg-[#0B3B68]/5 transition-colors">Cancelar</button>
                        <button type="submit" disabled={isLoading} className="flex-1 py-3 bg-[#7AC142] text-white font-bold rounded-xl hover:bg-[#7AC142]/90 flex justify-center items-center gap-2 transition-colors shadow-lg shadow-[#7AC142]/20">
                            {isLoading ? <Loader2 className="animate-spin"/> : (editingId ? 'Actualizar' : 'Guardar Cliente')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}
    </div>
  );
}