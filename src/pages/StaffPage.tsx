import { useEffect, useState } from 'react';
import { db, type Staff } from '../lib/db';
import { Trash2, UserPlus, Shield, User, Loader2, KeyRound } from 'lucide-react';

export function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  
  const [newRole, setNewRole] = useState<'admin' | 'vendedor'>('vendedor');

  const loadStaff = async () => {
    try {
      const items = await db.staff.toArray();
      setStaff(items);
    } catch (error) {
      console.error("Error cargando personal:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStaff();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length !== 4) return alert("El PIN debe ser de 4 dígitos");

    // ✅ CORRECCIÓN: Obtener el ID del negocio actual
    const businessId = localStorage.getItem('nexus_business_id');
    
    if (!businessId) {
        alert("Error crítico: No se encuentra el ID del negocio. Por favor reinicia sesión.");
        return;
    }

    try {
      await db.staff.add({
        id: crypto.randomUUID(),
        name: newName,
        pin: newPin,
        role: newRole,
        active: true,
        business_id: businessId // ✅ Ahora incluimos el campo obligatorio
      });
      setIsAdding(false);
      setNewName('');
      setNewPin('');
      loadStaff();
    } catch (error) {
      console.error(error);
      alert("Error al agregar (quizás el PIN ya existe)");
    }
  };

  const handleDelete = async (id: string) => {
    const targetStaff = staff.find(s => s.id === id);
    if (!targetStaff) return;

    if (targetStaff.role === 'admin') {
      const adminCount = staff.filter(s => s.role === 'admin').length;
      if (adminCount <= 1) {
        alert("⛔ ACCIÓN DENEGADA\n\nNo puedes eliminar al último Administrador.");
        return; 
      }
    }

    if (!confirm(`¿Estás seguro de eliminar a ${targetStaff.name}?`)) return;

    try {
      await db.staff.delete(id);
      loadStaff();
    } catch (error) {
      console.error(error);
      alert("Error al eliminar");
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <User className="text-indigo-600"/> Gestión de Equipo
        </h1>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-bold transition-colors"
        >
          <UserPlus size={18}/> {isAdding ? 'Cancelar' : 'Nuevo Empleado'}
        </button>
      </div>

      {isAdding && (
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-indigo-100 mb-8 animate-in slide-in-from-top-4">
          <h3 className="font-bold text-slate-700 mb-4">Registrar Nuevo Colaborador</h3>
          <form onSubmit={handleAdd} className="grid gap-4 sm:grid-cols-4 items-end">
            <div className="sm:col-span-1">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre</label>
                <input required type="text" value={newName} onChange={e => setNewName(e.target.value)} className="w-full p-2 border rounded-lg" placeholder="Ej. Juan Pérez"/>
            </div>
            <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">PIN (4 Dígitos)</label>
                <input required type="text" maxLength={4} value={newPin} onChange={e => setNewPin(e.target.value)} className="w-full p-2 border rounded-lg font-mono text-center" placeholder="0000"/>
            </div>
            <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Rol</label>
                <select 
                  value={newRole} 
                  onChange={e => setNewRole(e.target.value as 'admin' | 'vendedor')} 
                  className="w-full p-2 border rounded-lg bg-white"
                >
                    <option value="vendedor">Vendedor</option>
                    <option value="admin">Administrador</option>
                </select>
            </div>
            <button type="submit" className="bg-green-600 hover:bg-green-700 text-white p-2 rounded-lg font-bold shadow-sm">
                Guardar
            </button>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
            <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-indigo-500"/></div>
        ) : staff.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No hay empleados registrados.</div>
        ) : (
            <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                    <tr>
                        <th className="p-4">Nombre</th>
                        <th className="p-4">Rol</th>
                        <th className="p-4">PIN</th>
                        <th className="p-4 text-right">Acciones</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {staff.map(member => (
                        <tr key={member.id} className="hover:bg-slate-50">
                            <td className="p-4 font-bold text-slate-700">{member.name}</td>
                            <td className="p-4">
                                <span className={`px-2 py-1 rounded-full text-xs font-bold flex w-fit items-center gap-1 ${member.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                    {member.role === 'admin' ? <Shield size={12}/> : <User size={12}/>}
                                    {member.role === 'admin' ? 'ADMIN' : 'VENDEDOR'}
                                </span>
                            </td>
                            <td className="p-4 font-mono text-slate-500 flex items-center gap-2">
                                <KeyRound size={14}/> ****
                            </td>
                            <td className="p-4 text-right">
                                <button 
                                    onClick={() => handleDelete(member.id)}
                                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Eliminar"
                                >
                                    <Trash2 size={18}/>
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        )}
      </div>
    </div>
  );
}