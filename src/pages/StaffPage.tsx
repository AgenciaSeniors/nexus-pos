import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Staff } from '../lib/db';
import { Users, UserPlus, Trash2, Shield, ShieldAlert, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export function StaffPage() {
  // 1. Obtener contexto de seguridad
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id');

  // 2. Carga BLINDADA de empleados (Solo del negocio actual)
  const staffMembers = useLiveQuery(async () => {
    if (!businessId) return [];
    return await db.staff
      .where('business_id').equals(businessId)
      .toArray();
  }, [businessId]) || [];

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    role: 'vendedor' as 'admin' | 'vendedor',
    pin: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return toast.error("Error de sesión: No hay negocio activo");

    // VALIDACIÓN DE PIN (4 Dígitos Numéricos)
    if (!/^\d{4}$/.test(formData.pin)) {
        return toast.error("El PIN debe ser de 4 números exactos.");
    }

    setIsLoading(true);
    try {
      // Verificar si el PIN ya existe en ESTE negocio
      const existing = await db.staff
        .where({ business_id: businessId, pin: formData.pin })
        .first();

      if (existing) {
        toast.warning(`El PIN ${formData.pin} ya está en uso por ${existing.name}`);
        setIsLoading(false);
        return;
      }

      await db.staff.add({
        id: crypto.randomUUID(),
        business_id: businessId, // ✅ Vinculación Crítica
        name: formData.name,
        role: formData.role,
        pin: formData.pin,
        active: true
      });

      toast.success('Empleado registrado correctamente');
      setIsFormOpen(false);
      setFormData({ name: '', role: 'vendedor', pin: '' });

    } catch (error) {
      console.error(error);
      toast.error('Error al crear empleado');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (staffId: string, staffName: string, staffRole: string) => {
    if (!businessId) return;

    // 🛡️ REGLA 1: No puedes borrarte a ti mismo
    if (staffId === currentStaff.id) {
        return toast.error("No puedes eliminar tu propio usuario activo.");
    }

    // 🛡️ REGLA 2: No puedes dejar al negocio sin administradores
    if (staffRole === 'admin') {
        const adminCount = staffMembers.filter(s => s.role === 'admin').length;
        if (adminCount <= 1) {
            return toast.error("¡Acción bloqueada! No puedes eliminar al último administrador del negocio.");
        }
    }

    if (!confirm(`¿Eliminar acceso a ${staffName}?`)) return;

    try {
      await db.staff.delete(staffId);
      toast.success('Empleado eliminado');
    } catch (error) {
      console.error(error);
      toast.error('Error al eliminar');
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto pb-24">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Users className="text-indigo-600"/> Equipo de Trabajo
          </h1>
          <p className="text-slate-500 text-sm">Gestiona el acceso y roles de tus empleados.</p>
        </div>
        <button 
          onClick={() => setIsFormOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-bold shadow-sm transition-colors"
        >
          <UserPlus size={18}/> Nuevo Empleado
        </button>
      </div>

      {/* LISTA DE EMPLEADOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {staffMembers.map(staff => (
          <div key={staff.id} className={`bg-white p-5 rounded-2xl border ${staff.id === currentStaff.id ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-slate-200'} shadow-sm flex justify-between items-start group`}>
            <div className="flex gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${staff.role === 'admin' ? 'bg-purple-100 text-purple-600' : 'bg-emerald-100 text-emerald-600'}`}>
                    {staff.name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                    <h3 className="font-bold text-slate-800">{staff.name}</h3>
                    <div className="flex items-center gap-2 text-xs font-bold uppercase mt-1">
                        {staff.role === 'admin' ? (
                            <span className="text-purple-600 flex items-center gap-1"><Shield size={12}/> Admin</span>
                        ) : (
                            <span className="text-emerald-600 flex items-center gap-1"><UserPlus size={12}/> Vendedor</span>
                        )}
                        {staff.id === currentStaff.id && <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">TÚ</span>}
                    </div>
                    <div className="mt-2 text-slate-400 text-xs flex items-center gap-1">
                        <KeyRound size={12}/> PIN: ••••
                    </div>
                </div>
            </div>

            <button 
                onClick={() => handleDelete(staff.id, staff.name, staff.role)}
                className={`p-2 rounded-lg transition-colors ${staff.id === currentStaff.id ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'}`}
                disabled={staff.id === currentStaff.id}
                title={staff.id === currentStaff.id ? "No puedes eliminarte a ti mismo" : "Eliminar empleado"}
            >
                <Trash2 size={18}/>
            </button>
          </div>
        ))}
      </div>

      {/* MODAL DE REGISTRO */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                    <h2 className="text-xl font-bold text-slate-800">Nuevo Acceso</h2>
                    <p className="text-xs text-slate-500 mt-1">Crea un PIN único para que tu empleado inicie sesión.</p>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre del Empleado</label>
                        <input autoFocus required type="text" className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Ej. Ana García" />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Rol</label>
                            <select className="w-full p-3 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as never})}>
                                <option value="vendedor">Vendedor</option>
                                <option value="admin">Administrador</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">PIN de Acceso</label>
                            <input required type="text" maxLength={4} pattern="\d{4}" className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-center tracking-widest text-lg"
                                value={formData.pin} onChange={e => setFormData({...formData, pin: e.target.value.replace(/\D/g,'')})} placeholder="0000" />
                        </div>
                    </div>

                    {formData.role === 'admin' && (
                        <div className="bg-purple-50 p-3 rounded-xl flex gap-3 items-start text-xs text-purple-700 border border-purple-100">
                            <ShieldAlert size={16} className="shrink-0 mt-0.5"/>
                            <p>Los administradores tienen acceso total: pueden ver finanzas, modificar inventario y gestionar empleados.</p>
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={() => setIsFormOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors">Cancelar</button>
                        <button type="submit" disabled={isLoading} className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 flex justify-center items-center gap-2 transition-colors">
                            {isLoading ? <Loader2 className="animate-spin"/> : 'Crear Acceso'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}
    </div>
  );
}