import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { db, type Customer, type Staff } from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { UserPlus, Search, Edit2, Trash2, Users, Loader2, Phone, Mail, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { addToQueue, syncPush } from '../lib/sync';
import { logAuditAction } from '../lib/audit';

export function CustomersPage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id');

  // Carga de clientes (Solo activos y del negocio actual)
  const customers = useLiveQuery(async () => {
    if (!businessId) return [];
    return await db.customers
      .where('business_id').equals(businessId)
      .filter(c => !c.deleted_at) // Filtro de seguridad (Soft Delete)
      .reverse()
      .sortBy('created_at');
  }, [businessId]) || [];

  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: ''
  });

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.phone && c.phone.includes(searchTerm))
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return toast.error("Error de sesión: No hay negocio activo");
    
    setIsLoading(true);
    try {
        const cleanName = formData.name.trim();
        const cleanPhone = formData.phone.trim();
        
        if (!cleanName) {
            setIsLoading(false);
            return toast.warning("El nombre es obligatorio");
        }

        // Validación de duplicados por teléfono (si existe)
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
                // === EDICIÓN ===
                const original = await db.customers.get(editingId);
                if (!original) throw new Error("Cliente no encontrado");

                const updatedCustomer = {
                    ...original,
                    ...customerData,
                    sync_status: 'pending_update' as const,
                    updated_at: new Date().toISOString()
                };

                await db.customers.put(updatedCustomer);
                await addToQueue('CUSTOMER_SYNC', updatedCustomer);
                await logAuditAction('UPDATE_CUSTOMER', { name: updatedCustomer.name, id: updatedCustomer.id }, currentStaff);
                
                toast.success("Cliente actualizado");
            } else {
                // === CREACIÓN ===
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
                
                toast.success("Cliente registrado exitosamente");
            }
        });

        setIsFormOpen(false);
        resetForm();
        
        // Intentar subir cambios ya
        syncPush().catch(console.error);

    } catch (error) {
        console.error(error);
        toast.error("Ocurrió un error al guardar");
    } finally {
        setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este cliente?')) return;

    try {
        const customer = await db.customers.get(id);
        if (!customer) return;

        // Soft Delete: Marcar como borrado, no destruir
        const deletedCustomer = { 
            ...customer, 
            deleted_at: new Date().toISOString(),
            sync_status: 'pending_update' as const 
        };

        await db.transaction('rw', [db.customers, db.action_queue, db.audit_logs], async () => {
            await db.customers.put(deletedCustomer);
            await addToQueue('CUSTOMER_SYNC', deletedCustomer);
            await logAuditAction('DELETE_CUSTOMER', { name: customer.name, id: customer.id }, currentStaff);
        });
        
        toast.success("Cliente eliminado");
        syncPush().catch(console.error);

    } catch (error) {
        console.error(error);
        toast.error("Error al eliminar el cliente");
    }
  };

  const handleEdit = (c: Customer) => {
    setEditingId(c.id);
    setFormData({
        name: c.name,
        phone: c.phone || '',
        email: c.email || '',
        address: c.address || ''
    });
    setIsFormOpen(true);
  };

  const resetForm = () => {
    setFormData({ name: '', phone: '', email: '', address: '' });
    setEditingId(null);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto pb-24">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
        <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <Users className="text-indigo-600" /> Directorio de Clientes
            </h1>
            <p className="text-slate-500 text-sm">Gestiona tu base de datos y fidelización</p>
        </div>
        
        <div className="flex w-full sm:w-auto gap-2">
            <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input 
                    type="text" 
                    placeholder="Buscar por nombre o teléfono..." 
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                />
            </div>
            <button 
                onClick={() => { resetForm(); setIsFormOpen(true); }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-bold shadow-sm transition-colors"
            >
                <UserPlus size={18} /> <span className="hidden sm:inline">Nuevo Cliente</span>
            </button>
        </div>
      </div>

      {/* LISTA */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-300">
        {!customers ? (
             <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-indigo-500"/></div>
        ) : filteredCustomers.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Users size={32} className="text-slate-300"/>
                </div>
                <p>No se encontraron clientes.</p>
                {searchTerm && <p className="text-xs mt-1 text-slate-400">Prueba con otro término de búsqueda.</p>}
            </div>
        ) : (
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold border-b border-slate-100">
                        <tr>
                            <th className="p-4">Cliente</th>
                            <th className="p-4">Contacto</th>
                            <th className="p-4 hidden sm:table-cell">Dirección</th>
                            <th className="p-4 text-center">Fidelidad</th>
                            <th className="p-4 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredCustomers.map(c => (
                            <tr key={c.id} className="hover:bg-slate-50/80 transition-colors group">
                                <td className="p-4">
                                    <div className="font-bold text-slate-700">{c.name}</div>
                                    <div className="text-xs text-slate-400">Registrado: {new Date(c.created_at || Date.now()).toLocaleDateString()}</div>
                                </td>
                                <td className="p-4 text-sm text-slate-600">
                                    {c.phone && <div className="flex items-center gap-2 mb-1"><Phone size={14} className="text-indigo-400"/> {c.phone}</div>}
                                    {c.email && <div className="flex items-center gap-2"><Mail size={14} className="text-indigo-400"/> {c.email}</div>}
                                    {!c.phone && !c.email && <span className="text-slate-300 italic text-xs">Sin contacto</span>}
                                </td>
                                <td className="p-4 text-sm text-slate-500 hidden sm:table-cell">
                                    {c.address ? (
                                        <div className="flex items-start gap-2">
                                            <MapPin size={14} className="text-slate-400 mt-0.5 shrink-0"/> 
                                            <span className="truncate max-w-[200px]">{c.address}</span>
                                        </div>
                                    ) : '-'}
                                </td>
                                <td className="p-4 text-center">
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${c.loyalty_points && c.loyalty_points > 0 ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
                                        {c.loyalty_points || 0} pts
                                    </span>
                                </td>
                                <td className="p-4 text-right">
                                    <div className="flex justify-end gap-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handleEdit(c)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Editar">
                                            <Edit2 size={18}/>
                                        </button>
                                        <button onClick={() => handleDelete(c.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar">
                                            <Trash2 size={18}/>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
      </div>

      {/* MODAL FORMULARIO */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
                <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-slate-800">{editingId ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
                    <button onClick={() => setIsFormOpen(false)} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre Completo <span className="text-red-500">*</span></label>
                        <input autoFocus required type="text" className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Ej. Juan Pérez" />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Teléfono</label>
                            <input type="tel" className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="Ej. 555-1234" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label>
                            <input type="email" className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="juan@mail.com" />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Dirección</label>
                        <input type="text" className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="Calle Principal #123..." />
                    </div>
                    
                    <div className="flex gap-3 pt-4">
                        <button type="button" onClick={() => setIsFormOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors">
                            Cancelar
                        </button>
                        <button type="submit" disabled={isLoading} className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 flex justify-center items-center gap-2 transition-colors shadow-lg shadow-indigo-200">
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