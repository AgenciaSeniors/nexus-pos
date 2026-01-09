import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Customer } from '../lib/db';
import { supabase } from '../lib/supabase';
import { UserPlus, User, Search, X } from 'lucide-react';

interface CustomerSelectProps {
  onSelect: (customer: Customer | null) => void;
  selectedCustomer: Customer | null;
}

export function CustomerSelect({ onSelect, selectedCustomer }: CustomerSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', phone: '' });

  const customers = useLiveQuery(() => 
    db.customers
      .filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || c.phone?.includes(query) || false)
      .limit(5)
      .toArray()
  , [query]);

  const handleCreate = async () => {
    if (!newClient.name) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', session?.user.id).single();
      
      const customer: Customer = {
        id: crypto.randomUUID(),
        business_id: profile?.business_id,
        name: newClient.name,
        phone: newClient.phone,
        sync_status: 'pending_create'
      };

      await db.customers.add(customer);
      onSelect(customer);
      setIsCreating(false);
      setIsOpen(false);
      setNewClient({ name: '', phone: '' });
    } catch (e) {
      console.error(e);
    }
  };

  if (selectedCustomer) {
    return (
      <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 p-3 rounded-lg mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-200 p-2 rounded-full text-indigo-700">
            <User size={20} />
          </div>
          <div>
            <p className="font-bold text-indigo-900 text-sm">{selectedCustomer.name}</p>
            <p className="text-xs text-indigo-600">{selectedCustomer.phone || 'Sin teléfono'}</p>
          </div>
        </div>
        <button onClick={() => onSelect(null)} className="text-indigo-400 hover:text-red-500">
          <X size={20} />
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 relative">
      {!isOpen ? (
        <button onClick={() => setIsOpen(true)} className="w-full py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 font-medium hover:border-indigo-400 hover:text-indigo-500 transition-colors flex items-center justify-center gap-2">
          <UserPlus size={20} />
          Asignar Cliente
        </button>
      ) : (
        <div className="bg-white border shadow-sm rounded-lg p-3 animate-fade-in">
           {!isCreating ? (
             <>
               <div className="flex gap-2 mb-2">
                 <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-3 text-slate-400" />
                    <input autoFocus className="w-full pl-9 p-2 border rounded bg-slate-50 text-sm" placeholder="Buscar..." value={query} onChange={e => setQuery(e.target.value)} />
                 </div>
                 <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600"><X /></button>
               </div>
               <div className="space-y-1 max-h-40 overflow-y-auto">
                 {customers?.map(c => (
                   <button key={c.id} onClick={() => { onSelect(c); setIsOpen(false); }} className="w-full text-left p-2 hover:bg-slate-50 rounded text-sm flex justify-between group">
                     <span className="font-medium text-slate-700">{c.name}</span>
                   </button>
                 ))}
                 {query && <button onClick={() => setIsCreating(true)} className="w-full text-left p-2 text-indigo-600 font-bold text-sm hover:bg-indigo-50 rounded">+ Crear "{query}"</button>}
               </div>
             </>
           ) : (
             <div className="space-y-3">
               <input className="w-full p-2 border rounded text-sm" placeholder="Nombre" value={newClient.name} onChange={e => setNewClient({...newClient, name: e.target.value})} />
               <input className="w-full p-2 border rounded text-sm" placeholder="Teléfono" value={newClient.phone} onChange={e => setNewClient({...newClient, phone: e.target.value})} />
               <div className="flex gap-2">
                 <button onClick={handleCreate} className="flex-1 bg-indigo-600 text-white text-sm py-2 rounded font-bold">Guardar</button>
                 <button onClick={() => setIsCreating(false)} className="px-3 bg-slate-100 text-slate-600 text-sm rounded">Cancelar</button>
               </div>
             </div>
           )}
        </div>
      )}
    </div>
  );
}