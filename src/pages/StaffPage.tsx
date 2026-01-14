import { useEffect, useState } from 'react';
import { db, type Staff } from '../lib/db';
import { Trash2, UserPlus, Shield, User, Loader2, KeyRound } from 'lucide-react';
import { toast } from 'sonner'; // Asumiendo que usas sonner por los cambios anteriores

export function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  
  const [newRole, setNewRole] = useState<'admin' | 'vendedor'>('vendedor');

  // ✅ Obtener business_id seguro
  const businessId = localStorage.getItem('nexus_business_id');

  const loadStaff = async () => {
    if (!businessId) return;
    
    try {
      // ✅ CORRECCIÓN: Filtramos por business_id
      const items = await db.staff
        .where('business_id')
        .equals(businessId)
        .toArray();
        
      setStaff(items);
    } catch (error) {
      console.error("Error cargando personal:", error);
      toast.error("Error al cargar lista de empleados");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStaff();
  }, [businessId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length !== 4) return toast.warning("El PIN debe ser de 4 dígitos");
    if (!businessId) return toast.error("Error de sesión: Reinicia la aplicación");

    try {
      await db.staff.add({
        id: crypto.randomUUID(),
        name: newName,
        pin: newPin,
        role: newRole,
        active: true,
        business_id: businessId // ✅ Guardamos con el ID correcto
      });
      
      setIsAdding(false);
      setNewName('');
      setNewPin('');
      toast.success("Empleado registrado");
      loadStaff();
    } catch (error) {
      console.error(error);
      toast.error("Error al agregar (verifica que el PIN no esté duplicado)");
    }
  };

  const handleDelete = async (id: string) => {
    const targetStaff = staff.find(s => s.id === id);
    if (!targetStaff) return;

    if (targetStaff.role === 'admin') {
      const adminCount = staff.filter(s => s.role === 'admin').length;
      if (adminCount <= 1) {
        toast.error("No puedes eliminar al último Administrador.");
        return; 
      }
    }

    // Usamos toast con promesa o confirmación simple
    if (!confirm(`¿Eliminar a ${targetStaff.name}?`)) return;

    try {
      await db.staff.delete(id);
      toast.success("Empleado eliminado");
      loadStaff();
    } catch (error) {
      console.error(error);
      toast.error("Error al eliminar");
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
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-bold transition-colors shadow-sm"
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
                <input required type="text" value={newName} onChange={e => setNewName(e.target.value)} className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Ej. Juan Pérez"/>
            </div>
            <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">PIN (4 Dígitos)</label>
                <input required type="text" maxLength={4} value={newPin} onChange={e => setNewPin(e.target.value)} className="w-full p-2 border rounded-lg font-mono text-center focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="0000"/>
            </div>
            <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Rol</label>
                <select 
                  value={newRole} 
                  onChange={e => setNewRole(e.target.value as 'admin' | 'vendedor')} 
                  className="w-full p-2 border rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                    <option value="vendedor">Vendedor</option>
                    <option value="admin">Administrador</option>
                </select>
            </div>
            <button type="submit" className="bg-green-600 hover:bg-green-700 text-white p-2 rounded-lg font-bold shadow-sm transition-colors">
                Guardar
            </button>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
            <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-indigo-500"/></div>
        ) : staff.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center gap-2">
                <User size={48} className="text-slate-200" />
                <p className="text-slate-500 font-medium">No hay empleados registrados en este negocio.</p>
                <p className="text-slate-400 text-sm">Agrega el primero usando el botón superior.</p>
            </div>
        ) : (
            <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold border-b border-slate-100">
                    <tr>
                        <th className="p-4 pl-6">Nombre</th>
                        <th className="p-4">Rol</th>
                        <th className="p-4">PIN</th>
                        <th className="p-4 text-right pr-6">Acciones</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {staff.map(member => (
                        <tr key={member.id} className="hover:bg-slate-50 transition-colors">
                            <td className="p-4 pl-6 font-bold text-slate-700 flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${member.role === 'admin' ? 'bg-purple-500' : 'bg-indigo-500'}`}>
                                    {member.name.substring(0,2).toUpperCase()}
                                </div>
                                {member.name}
                            </td>
                            <td className="p-4">
                                <span className={`px-2 py-1 rounded-full text-xs font-bold flex w-fit items-center gap-1 ${member.role === 'admin' ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                                    {member.role === 'admin' ? <Shield size={12}/> : <User size={12}/>}
                                    {member.role === 'admin' ? 'ADMIN' : 'VENDEDOR'}
                                </span>
                            </td>
                            <td className="p-4 font-mono text-slate-500 flex items-center gap-2">
                                <KeyRound size={14} className="text-slate-300"/> ****
                            </td>
                            <td className="p-4 text-right pr-6">
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