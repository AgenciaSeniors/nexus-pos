import { useState } from 'react';
import { useOutletContext } from 'react-router-dom'; // ✅ Contexto de usuario
import { db, type Customer, type Staff } from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { UserPlus, Search, Edit2, Trash2, Users, Loader2, Phone, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { addToQueue } from '../lib/sync'; // ✅ Sincronización
import { logAuditAction } from '../lib/audit'; // ✅ Auditoría

export function CustomersPage() {
  // 1. Obtener contexto de seguridad
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id');

  // 2. Carga BLINDADA de clientes (Solo del negocio actual)
  const customers = useLiveQuery(async () => {
    if (!businessId) return [];
    return await db.customers
      .where('business_id').equals(businessId)
      .filter(c => !c.deleted_at) // Solo activos
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
    address: '' // Si decides agregar dirección en el futuro
  });

  // Filtro visual
  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.phone && c.phone.includes(searchTerm))
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return toast.error("Error de sesión");
    
    setIsLoading(true);
    try {
        // ✅ VALIDACIÓN: Evitar duplicados por Teléfono (si se ingresó uno)
        if (formData.phone.trim()) {
            const duplicate = await db.customers
                .where({ business_id: businessId })
                .filter(c => c.phone === formData.phone && !c.deleted_at)
                .first();
            
            if (duplicate && duplicate.id !== editingId) {
                toast.warning(`El teléfono ${formData.phone} ya pertenece a ${duplicate.name}`);
                setIsLoading(false);
                return;
            }
        }

        const customerData = {
            name: formData.name.trim(),
            phone: formData.phone.trim() || undefined,
            email: formData.email.trim() || undefined,
            // address: formData.address // Si agregas el campo
        };

        if (editingId) {
            // === MODO EDICIÓN ===
            const original = await db.customers.get(editingId);
            if (!original) return;

            const updatedCustomer = {
                ...original,
                ...customerData,
                sync_status: 'pending_update' as const
            };

            await db.customers.put(updatedCustomer);
            await addToQueue('CUSTOMER_SYNC', updatedCustomer);
            
            // Opcional: Audit Log de edición
            // await logAuditAction('UPDATE_CUSTOMER', { name: updatedCustomer.name }, currentStaff);
            
            toast.success("Cliente actualizado");
        } else {
            // === MODO CREACIÓN ===
            const newCustomer: Customer = {
                id: crypto.randomUUID(),
                business_id: businessId,
                ...customerData,
                loyalty_points: 0,
                sync_status: 'pending_create' as const
            };

            await db.customers.add(newCustomer);
            await addToQueue('CUSTOMER_SYNC', newCustomer);
            toast.success("Cliente registrado");
        }

        setIsFormOpen(false);
        resetForm();

    } catch (error) {
        console.error(error);
        toast.error("Error al guardar cliente");
    } finally {
        setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar cliente? Se mantendrá en el historial de ventas.')) return;

    try {
        const customer = await db.customers.get(id);
        if (!customer) return;

        const deletedCustomer = { 
            ...customer, 
            deleted_at: new Date().toISOString(),
            sync_status: 'pending_update' as const 
        };

        await db.customers.put(deletedCustomer);
        await addToQueue('CUSTOMER_SYNC', deletedCustomer);
        
        // ✅ Auditoría de seguridad
        await logAuditAction('DELETE_CUSTOMER', { name: customer.name, id: customer.id }, currentStaff);
        
        toast.success("Cliente eliminado");
    } catch (error) {
      console.error(error);
        toast.error("Error al eliminar");
    }
  };

  const handleEdit = (c: Customer) => {
    setEditingId(c.id);
    setFormData({
        name: c.name,
        phone: c.phone || '',
        email: c.email || '',
        address: ''
    });
    setIsFormOpen(true);
  };

  const resetForm = () => {
    setFormData({ name: '', phone: '', email: '', address: '' });
    setEditingId(null);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
        <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <Users className="text-indigo-600" /> Clientes
            </h1>
            <p className="text-slate-500 text-sm">Base de datos de fidelización</p>
        </div>
        
        <div className="flex w-full sm:w-auto gap-2">
            <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input 
                    type="text" 
                    placeholder="Buscar nombre o teléfono..." 
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
            </div>
            <button 
                onClick={() => { resetForm(); setIsFormOpen(true); }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-bold shadow-sm transition-colors"
            >
                <UserPlus size={18} /> <span className="hidden sm:inline">Nuevo</span>
            </button>
        </div>
      </div>

      {/* LISTA */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {filteredCustomers.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
                <Users size={48} className="mx-auto mb-2 opacity-20"/>
                <p>No se encontraron clientes</p>
            </div>
        ) : (
            <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                    <tr>
                        <th className="p-4">Nombre</th>
                        <th className="p-4">Contacto</th>
                        <th className="p-4 text-center">Puntos</th>
                        <th className="p-4 text-right">Acciones</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {filteredCustomers.map(c => (
                        <tr key={c.id} className="hover:bg-slate-50/80 transition-colors group">
                            <td className="p-4 font-bold text-slate-700">{c.name}</td>
                            <td className="p-4 text-sm text-slate-600">
                                {c.phone && <div className="flex items-center gap-2"><Phone size={14} className="text-slate-400"/> {c.phone}</div>}
                                {c.email && <div className="flex items-center gap-2 mt-1"><Mail size={14} className="text-slate-400"/> {c.email}</div>}
                            </td>
                            <td className="p-4 text-center">
                                <span className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded-lg text-xs font-bold">
                                    {c.loyalty_points || 0} pts
                                </span>
                            </td>
                            <td className="p-4 text-right">
                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => handleEdit(c)} className="p-2 text-slate-400 hover:text-indigo-600 bg-white border border-slate-200 rounded-lg hover:border-indigo-200">
                                        <Edit2 size={16}/>
                                    </button>
                                    <button onClick={() => handleDelete(c.id)} className="p-2 text-slate-400 hover:text-red-600 bg-white border border-slate-200 rounded-lg hover:border-red-200">
                                        <Trash2 size={16}/>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        )}
      </div>

      {/* MODAL */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
                <div className="p-6 border-b border-slate-100">
                    <h2 className="text-xl font-bold text-slate-800">{editingId ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre Completo</label>
                        <input autoFocus required type="text" className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Teléfono</label>
                        <input type="tel" className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="Opcional" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label>
                        <input type="email" className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="Opcional" />
                    </div>
                    
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={() => setIsFormOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200">
                            Cancelar
                        </button>
                        <button type="submit" disabled={isLoading} className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 flex justify-center items-center gap-2">
                            {isLoading ? <Loader2 className="animate-spin"/> : 'Guardar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}
    </div>
  );
}