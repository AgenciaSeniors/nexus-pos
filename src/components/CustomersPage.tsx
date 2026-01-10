import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Customer } from '../lib/db';
import { supabase } from '../lib/supabase';
import { syncPush } from '../lib/sync';
import { Search, UserPlus, Phone, Mail, Edit, User } from 'lucide-react';

export function CustomersPage() {
  const [query, setQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: ''
  });

  const customers = useLiveQuery(() => 
    db.customers
      .filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || c.phone?.includes(query) || false)
      .toArray()
  , [query]);

  const openCreate = () => {
    setEditingId(null);
    setFormData({ name: '', phone: '', email: '' });
    setIsFormOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditingId(c.id);
    setFormData({
      name: c.name,
      phone: c.phone || '',
      email: c.email || ''
    });
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await db.customers.update(editingId, {
          ...formData,
          sync_status: 'pending_update'
        });
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        // Intentamos obtener el business_id, si falla (offline), usamos el de localStorage o dejamos vacío temporalmente
        let businessId = localStorage.getItem('nexus_business_id') || '';
        
        if (!businessId && session) {
             const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', session.user.id).single();
             businessId = profile?.business_id || '';
        }

        await db.customers.add({
          id: crypto.randomUUID(),
          business_id: businessId,
          ...formData,
          sync_status: 'pending_create'
        });
      }
      setIsFormOpen(false);
      setEditingId(null);
      syncPush().catch(console.error);
    } catch (error) {
      console.error(error);
      alert('Error al guardar cliente');
    }
  };

  return (
    <div className="p-6 pb-20">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <User className="text-blue-600" /> Clientes
        </h1>
        <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow flex items-center gap-2">
          <UserPlus size={20} /> Nuevo Cliente
        </button>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-100 mb-6 flex gap-2">
        <Search className="text-slate-400" />
        <input 
          type="text" 
          placeholder="Buscar por nombre o teléfono..." 
          className="flex-1 outline-none text-slate-700"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-lg shadow-2xl w-full max-w-md animate-fade-in">
            <h2 className="text-xl font-bold mb-4">{editingId ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Nombre Completo</label>
                <input required type="text" className="w-full p-2 border rounded mt-1" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Teléfono</label>
                <input type="text" className="w-full p-2 border rounded mt-1" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Email (Opcional)</label>
                <input type="email" className="w-full p-2 border rounded mt-1" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
              </div>
              <div className="flex gap-2 mt-6">
                <button type="button" onClick={() => setIsFormOpen(false)} className="flex-1 bg-slate-100 text-slate-700 py-2 rounded hover:bg-slate-200">Cancelar</button>
                <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 font-bold">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {customers?.map(c => (
          <div key={c.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow flex justify-between items-start group">
            <div>
              <h3 className="font-bold text-slate-800 text-lg">{c.name}</h3>
              <div className="flex items-center gap-2 text-slate-500 text-sm mt-1">
                <Phone size={14} />
                <span>{c.phone || 'Sin teléfono'}</span>
              </div>
              {c.email && (
                <div className="flex items-center gap-2 text-slate-400 text-xs mt-1">
                  <Mail size={12} />
                  <span>{c.email}</span>
                </div>
              )}
            </div>
            <button onClick={() => openEdit(c)} className="p-2 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors">
              <Edit size={18} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}