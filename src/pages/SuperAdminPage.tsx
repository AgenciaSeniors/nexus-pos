import { useState } from 'react';
import { supabase } from '../lib/supabase';

export function SuperAdminPage() {
  const [form, setForm] = useState({ name: '', ownerEmail: '', ownerPassword: '' });
  const [loading, setLoading] = useState(false);

  const createBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      // 1. Crear el Negocio en la tabla businesses
      const { data: business, error: busError } = await supabase
        .from('businesses')
        .insert({ name: form.name, status: 'active' })
        .select()
        .single();
      
      if (busError) throw busError;

      // 2. Crear el Usuario en Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: form.ownerEmail,
        password: form.ownerPassword,
      });

      if (authError) throw authError;

      if (authData.user && business) {
        // 3. Crear el Perfil Admin vinculado
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: authData.user.id,
            business_id: business.id,
            role: 'admin',
            full_name: 'Admin ' + form.name
          });
          
        if (profileError) throw profileError;
        
        alert(`✅ Negocio "${form.name}" creado exitosamente!`);
        setForm({ name: '', ownerEmail: '', ownerPassword: '' });
      }

    } catch (error) {
  if (error instanceof Error) {
    alert('Error: ' + error.message);
  } else {
    alert('Ocurrió un error desconocido');
  }
}
  };

  return (
    <div className="p-10 max-w-lg mx-auto">
      <h1 className="text-3xl font-bold mb-6">🛠 Super Admin: Nuevo Cliente</h1>
      <form onSubmit={createBusiness} className="space-y-4 bg-white p-6 shadow-xl rounded-xl">
        <div>
          <label>Nombre del Negocio</label>
          <input className="w-full border p-2 rounded" value={form.name} onChange={e=>setForm({...form, name: e.target.value})} required />
        </div>
        <div>
          <label>Email del Dueño</label>
          <input className="w-full border p-2 rounded" type="email" value={form.ownerEmail} onChange={e=>setForm({...form, ownerEmail: e.target.value})} required />
        </div>
        <div>
          <label>Contraseña Inicial</label>
          <input className="w-full border p-2 rounded" type="text" value={form.ownerPassword} onChange={e=>setForm({...form, ownerPassword: e.target.value})} required />
        </div>
        <button disabled={loading} className="w-full bg-black text-white py-3 rounded font-bold">
          {loading ? 'Creando...' : '🚀 Dar de Alta y Cobrar'}
        </button>
      </form>
    </div>
  );
}