import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { Shield, UserPlus, Trash2, KeyRound } from 'lucide-react';

export function StaffPage() {
  const staff = useLiveQuery(() => db.staff.toArray());
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', pin: '', role: 'vendedor' as const });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.pin.length < 4) return alert("El PIN debe tener 4 dígitos");

    await db.staff.add({
      id: crypto.randomUUID(),
      name: formData.name,
      pin: formData.pin,
      role: formData.role,
      active: true
    });
    setIsFormOpen(false);
    setFormData({ name: '', pin: '', role: 'vendedor' });
  };

  const handleDelete = (id: string) => {
    if (confirm('¿Eliminar a este usuario?')) db.staff.delete(id);
  };

  return (
    <div className="p-6 pb-20">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Shield className="text-purple-600" /> Equipo y Accesos
        </h1>
        <button onClick={() => setIsFormOpen(true)} className="bg-slate-900 text-white px-4 py-2 rounded-lg shadow hover:bg-black flex gap-2 items-center transition-all">
          <UserPlus size={18} /> Nuevo Empleado
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {staff?.map(s => (
          <div key={s.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 flex justify-between items-center group hover:shadow-md transition-all">
            <div>
              <h3 className="font-bold text-lg text-slate-800">{s.name}</h3>
              <div className="text-sm text-slate-500 flex items-center gap-2 mt-1">
                <span className={`w-2 h-2 rounded-full ${s.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}`}></span>
                <span className="uppercase font-bold text-xs">{s.role}</span>
              </div>
              <div className="text-xs text-slate-400 mt-2 flex items-center gap-1 bg-slate-50 px-2 py-1 rounded w-fit">
                <KeyRound size={12} /> PIN: ••••
              </div>
            </div>
            <button onClick={() => handleDelete(s.id)} className="text-slate-300 hover:text-red-500 p-2 transition-colors">
              <Trash2 size={20}/>
            </button>
          </div>
        ))}
        {staff?.length === 0 && (
          <div className="col-span-full text-center py-10 text-slate-400 bg-slate-50 rounded-xl border border-dashed">
            No hay empleados registrados.
          </div>
        )}
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-sm animate-fade-in">
            <h2 className="font-bold text-xl mb-4 text-slate-800">Nuevo Acceso</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre</label>
                <input required className="w-full border p-2 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Ej: Juan Pérez" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">PIN (4 números)</label>
                <input required type="tel" maxLength={4} className="w-full border p-2 rounded-lg font-mono text-center text-xl tracking-[0.5em] focus:ring-2 focus:ring-purple-500 outline-none" value={formData.pin} onChange={e => setFormData({...formData, pin: e.target.value})} placeholder="0000" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Rol</label>
                <select className="w-full border p-2 rounded-lg bg-white" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as any})}>
                  <option value="vendedor">Vendedor (Solo Caja)</option>
                  <option value="admin">Administrador (Todo)</option>
                </select>
              </div>
              <div className="flex gap-2 mt-6">
                <button type="button" onClick={() => setIsFormOpen(false)} className="flex-1 py-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
                <button type="submit" className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-lg font-bold shadow-lg shadow-purple-200 transition-all">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}