import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import {
  Shield, Check, X, Search, RefreshCw, UserCheck, Inbox,
  CalendarPlus, Key, User, LogOut, Store, Trash2, AlertTriangle, Calendar, AlertOctagon,
  History, TrendingUp, Award, KeyRound, Eye, EyeOff, DollarSign, CheckCircle2, Edit2, FlaskConical, Zap, Star
} from 'lucide-react';
import { toast } from 'sonner';

// Interfaz completa
interface Profile {
  id: string;
  email?: string;
  full_name: string;
  phone: string;
  months_requested: number;
  status: 'pending' | 'active' | 'rejected' | 'suspended';
  created_at: string;
  initial_pin: string;
  license_expiry?: string;
  business_id?: string;
  role?: string;
  approved_by?: string;
  approved_by_name?: string;
  approved_at?: string;
}

type HistoryPeriod = 'day' | 'week' | 'month' | 'year';

type EventType = 'approval' | 'extension' | 'suspension' | 'reactivation' | 'password_reset';

interface LicenseEvent {
  id: string;
  profile_id: string;
  client_name: string;
  client_email?: string;
  event_type: EventType;
  months_granted?: number;
  new_expiry_at?: string;
  performed_by?: string;
  performed_by_name?: string;
  created_at: string;
}

type ConfirmAction = {
    type: 'suspend' | 'delete';
    item: Profile;
};

export function SuperAdminPage() {
  const navigate = useNavigate();
  
  // --- ESTADOS DE LA INTERFAZ ---
  const [activeTab, setActiveTab] = useState<'requests' | 'active' | 'history' | 'billing'>('requests');
  const [dataList, setDataList] = useState<Profile[]>([]);
  const [historyList, setHistoryList] = useState<LicenseEvent[]>([]);
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('month');
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // --- BILLING ---
  interface BillingRow {
    business_id: string;
    business_name: string;
    owner_name: string;
    total_sales: number;
    rate: number;          // porcentaje auto-detectado: 1% (≤500k) | 0.5% (>500k)
    tier: 'standard' | 'plus'; // standard = hasta 500k, plus = más de 500k
    fee: number;           // total_sales * rate / 100
    paid_until: string | null;
    billing_id: string | null;
    period: string;        // 'YYYY-MM'
  }
  const [billingRows, setBillingRows] = useState<BillingRow[]>([]);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState(() => {
    const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
  });
  const fetchBilling = async (period: string) => {
    setBillingLoading(true);
    try {
      // 1. Negocios activos
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, business_id')
        .in('status', ['active', 'suspended'])
        .not('business_id', 'is', null);

      if (!profiles?.length) { setBillingRows([]); return; }

      // 2. Totales de ventas del período (mes seleccionado) por business_id
      const [year, month] = period.split('-').map(Number);
      const from = new Date(year, month - 1, 1).toISOString();
      const to   = new Date(year, month, 1).toISOString();

      const { data: salesData } = await supabase
        .from('sales')
        .select('business_id, total, status')
        .gte('date', from)
        .lt('date', to)
        .neq('status', 'voided');

      // 3. Configuración de billing guardada
      const bizIds = profiles.map(p => p.business_id!);
      const { data: billingData } = await supabase
        .from('billing')
        .select('*')
        .in('business_id', bizIds);

      // 4. Nombres de negocios
      const { data: businesses } = await supabase
        .from('businesses')
        .select('id, name')
        .in('id', bizIds);

      const salesByBiz: Record<string, number> = {};
      (salesData || []).forEach(s => {
        salesByBiz[s.business_id] = (salesByBiz[s.business_id] || 0) + Number(s.total || 0);
      });

      // Deduplicar por business_id (un negocio puede tener varios perfiles)
      const seenBiz = new Set<string>();
      const uniqueProfiles = profiles.filter(p => {
        if (seenBiz.has(p.business_id!)) return false;
        seenBiz.add(p.business_id!);
        return true;
      });

      const rows: BillingRow[] = uniqueProfiles.map(p => {
        const billing = (billingData || []).find(b => b.business_id === p.business_id);
        const bizName = (businesses || []).find(b => b.id === p.business_id)?.name || p.full_name;
        const totalSales = salesByBiz[p.business_id!] || 0;
        // Tarifa auto-detectada según volumen mensual de ventas
        const tier: 'standard' | 'plus' = totalSales > 500_000 ? 'plus' : 'standard';
        const rate = tier === 'plus' ? 0.5 : 1.0;
        return {
          business_id: p.business_id!,
          business_name: bizName,
          owner_name: p.full_name,
          total_sales: totalSales,
          rate,
          tier,
          fee: totalSales * rate / 100,
          paid_until: billing?.paid_until ?? null,
          billing_id: billing?.id ?? null,
          period,
        };
      });

      setBillingRows(rows.sort((a, b) => b.total_sales - a.total_sales));
    } catch (e) {
      console.error(e);
      toast.error('Error cargando facturación');
    } finally {
      setBillingLoading(false);
    }
  };


  const handleMarkPaid = async (row: BillingRow) => {
    const [py, pm] = row.period.split('-').map(Number);
    const d = new Date(py, pm, 0); // último día del mes en hora local
    const paidUntil = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    try {
      await supabase.from('billing').upsert(
        { ...(row.billing_id ? { id: row.billing_id } : {}), business_id: row.business_id, rate: row.rate, paid_until: paidUntil, updated_at: new Date().toISOString() },
        { onConflict: 'business_id' }
      );
      fetchBilling(billingPeriod);
      toast.success(`Pago de ${row.business_name} confirmado`);
    } catch { toast.error('Error confirmando pago'); }
  };

  const handleGrantTrial = async (profile: Profile, days = 7) => {
    if (!profile.business_id) return toast.error("Este perfil no tiene un negocio asignado");
    try {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + days);
      const trialEndISO = trialEnd.toISOString();

      // Actualizar tabla businesses (sincroniza a local vía syncCriticalData)
      await supabase.from('businesses').update({
        status: 'trial',
        subscription_expires_at: trialEndISO,
      }).eq('id', profile.business_id);

      // Actualizar perfil para permitir el acceso
      await supabase.from('profiles').update({
        status: 'active',
        license_expiry: trialEndISO,
      }).eq('id', profile.id);

      // Registrar en historial
      const { id: adminId, name: adminName } = await getAdminInfo();
      await supabase.from('license_history').insert({
        profile_id: profile.id,
        client_name: profile.full_name,
        client_email: profile.email,
        event_type: 'approval',
        months_granted: 0,
        new_expiry_at: trialEndISO,
        performed_by: adminId,
        performed_by_name: adminName,
      });

      toast.success(`Período de prueba de ${days} días activado para ${profile.full_name}`);
      fetchData();
    } catch (err) {
      console.error(err);
      toast.error('Error activando período de prueba');
    }
  };

  const handleRevertPaid = async (row: BillingRow) => {
    if (!row.billing_id) return;
    try {
      await supabase.from('billing').update({ paid_until: null, updated_at: new Date().toISOString() }).eq('id', row.billing_id);
      fetchBilling(billingPeriod);
      toast.success(`Pago de ${row.business_name} revertido`);
    } catch { toast.error('Error revirtiendo pago'); }
  };

  const isPaid = (row: BillingRow) => {
    if (!row.paid_until) return false;
    const [y, m] = row.period.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const lastDayStr = `${row.period}-${String(lastDay).padStart(2,'0')}`;
    return row.paid_until >= lastDayStr; // comparación de strings ISO es segura
  };

  // --- MODALES ---
  const [approvingItem, setApprovingItem] = useState<Profile | null>(null);
  const [extendingItem, setExtendingItem] = useState<Profile | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmAction | null>(null);
  const [resetPasswordItem, setResetPasswordItem] = useState<Profile | null>(null);

  // --- VALORES DE FORMULARIO ---
  const [monthsToGrant, setMonthsToGrant] = useState(1);
  const [extendMonths, setExtendMonths] = useState(1);
  const [adminPin, setAdminPin] = useState('1234'); // Estado para el PIN (Ya no prompt)
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // 1. CARGA DE DATOS (Solicitudes y Clientes)
  const fetchData = useCallback(async () => {
    if (activeTab === 'history') return;
    setLoading(true);
    try {
      let query = supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (activeTab === 'requests') {
        query = query.eq('status', 'pending');
      } else {
        query = query.in('status', ['active', 'suspended', 'rejected']);
      }

      const { data, error } = await query;
      if (error) throw error;
      setDataList(data || []);

    } catch (error) {
      console.error('Error cargando usuarios:', error);
      toast.error("No se pudo cargar la lista de usuarios");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  // 2. CARGA DE HISTORIAL
  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      let fromDate: string;

      if (historyPeriod === 'day') {
        fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      } else if (historyPeriod === 'week') {
        const d = new Date(now);
        d.setDate(now.getDate() - now.getDay());
        d.setHours(0, 0, 0, 0);
        fromDate = d.toISOString();
      } else if (historyPeriod === 'month') {
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      } else {
        fromDate = new Date(now.getFullYear(), 0, 1).toISOString();
      }

      const { data, error } = await supabase
        .from('license_history')
        .select('*')
        .gte('created_at', fromDate)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setHistoryList(data || []);
    } catch (error) {
      console.error('Error cargando historial:', error);
      toast.error("No se pudo cargar el historial");
    } finally {
      setLoading(false);
    }
  }, [historyPeriod]);

  useEffect(() => {
    if (activeTab === 'history') fetchHistory();
    else if (activeTab === 'billing') fetchBilling(billingPeriod);
    else fetchData();
  }, [activeTab, fetchData, fetchHistory]);

  // 3. APROBACIÓN DE USUARIO (Con Modal Integrado)
  const executeApproval = async () => {
    if (!approvingItem) return;

    // Validación de PIN en el modal
    if (!adminPin || !/^\d{4}$/.test(adminPin)) {
        toast.warning("El PIN debe ser de 4 dígitos numéricos");
        return;
    }

    setLoading(true);
    try {
      const { id: adminId, name: approverName } = await getAdminInfo();

      const { error } = await supabase.rpc('approve_client_transaction', {
        target_user_id: approvingItem.id,
        months_to_grant: monthsToGrant,
        initial_pin: adminPin,
        admin_user_id: adminId
      });

      if (error) throw error;

      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + monthsToGrant);

      // Actualizar businesses → desactiva trial y aplica expiración real
      if (approvingItem.business_id) {
        await supabase.from('businesses').update({
          status: 'active',
          subscription_expires_at: expiryDate.toISOString(),
        }).eq('id', approvingItem.business_id);
      }

      // Registrar quién aprobó y cuándo
      await supabase.from('profiles').update({
        approved_by: adminId,
        approved_by_name: approverName,
        approved_at: new Date().toISOString()
      }).eq('id', approvingItem.id);

      // Registrar en historial
      await supabase.from('license_history').insert({
        profile_id: approvingItem.id,
        client_name: approvingItem.full_name,
        client_email: approvingItem.email,
        event_type: 'approval',
        months_granted: monthsToGrant,
        new_expiry_at: expiryDate.toISOString(),
        performed_by: adminId,
        performed_by_name: approverName,
      });

      toast.success(`Cliente aprobado. PIN Maestro: ${adminPin}`);
      setApprovingItem(null);
      setAdminPin('1234');
      fetchData();

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        console.error(err);
        toast.error("Error crítico: " + msg);
    } finally {
        setLoading(false);
    }
  };

  // 3. EXTENSIÓN DE LICENCIA
  const executeExtension = async () => {
    if (!extendingItem) return;

    try {
      const currentExpiry = extendingItem.license_expiry ? new Date(extendingItem.license_expiry) : new Date();
      const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
      baseDate.setMonth(baseDate.getMonth() + extendMonths);

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ license_expiry: baseDate.toISOString(), status: 'active' })
        .eq('id', extendingItem.id);

      if (profileError) throw profileError;

      if (extendingItem.business_id) {
        await supabase
          .from('businesses')
          .update({ subscription_expires_at: baseDate.toISOString(), status: 'active' })
          .eq('id', extendingItem.business_id);
      }

      // Registrar en historial
      const { id: adminId, name: adminName } = await getAdminInfo();
      await supabase.from('license_history').insert({
        profile_id: extendingItem.id,
        client_name: extendingItem.full_name,
        client_email: extendingItem.email,
        event_type: 'extension',
        months_granted: extendMonths,
        new_expiry_at: baseDate.toISOString(),
        performed_by: adminId,
        performed_by_name: adminName,
      });

      setExtendingItem(null);
      fetchData();
      toast.success("Licencia extendida correctamente.");

    } catch (err) {
      console.error(err);
      toast.error("Error al extender licencia");
    }
  };

  // 4. RESTABLECER CONTRASEÑA DE USUARIO
  const executeResetPassword = async () => {
    if (!resetPasswordItem) return;
    if (!newPassword || newPassword.length < 6) {
        toast.warning("La contraseña debe tener al menos 6 caracteres");
        return;
    }

    setLoading(true);
    try {
        const { error } = await supabase.rpc('reset_user_password', {
            target_user_id: resetPasswordItem.id,
            new_password: newPassword
        });

        if (error) throw error;

        // Registrar en historial
        const { id: adminId, name: adminName } = await getAdminInfo();
        await supabase.from('license_history').insert({
          profile_id: resetPasswordItem.id,
          client_name: resetPasswordItem.full_name,
          client_email: resetPasswordItem.email,
          event_type: 'password_reset',
          performed_by: adminId,
          performed_by_name: adminName,
        });

        toast.success(`Contraseña de ${resetPasswordItem.full_name} restablecida correctamente`);
        setResetPasswordItem(null);
        setNewPassword('');
        setShowNewPassword(false);

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        console.error(err);
        toast.error("Error al restablecer: " + msg);
    } finally {
        setLoading(false);
    }
  };

  // 5. EJECUTAR ACCIÓN DESTRUCTIVA (Suspender/Borrar)
  const executeConfirmAction = async () => {
      if (!confirmModal) return;
      const { type, item } = confirmModal;
      setLoading(true);

      try {
          if (type === 'suspend') {
              const newStatus = item.status === 'active' ? 'suspended' : 'active';
              await supabase.from('profiles').update({ status: newStatus }).eq('id', item.id);
              if (item.business_id) {
                  await supabase.from('businesses').update({ status: newStatus }).eq('id', item.business_id);
              }

              // Registrar en historial
              const { id: adminId, name: adminName } = await getAdminInfo();
              await supabase.from('license_history').insert({
                profile_id: item.id,
                client_name: item.full_name,
                client_email: item.email,
                event_type: newStatus === 'suspended' ? 'suspension' : 'reactivation',
                performed_by: adminId,
                performed_by_name: adminName,
              });

              toast.success(`Usuario ${newStatus === 'active' ? 'reactivado' : 'suspendido'}`);
          }
          else if (type === 'delete') {
              const { error } = await supabase.rpc('delete_user_completely', {
                  target_user_id: item.id
              });
              if (error) throw error;
              toast.success("Usuario eliminado completamente de la base de datos.");
          }

          setConfirmModal(null);
          fetchData();

      } catch (err: unknown) {
          console.error(err);
          const msg = err instanceof Error ? err.message : "Error desconocido";
          toast.error("Falló la operación: " + msg);
      } finally {
          setLoading(false);
      }
  };

  // Logout
  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/admin-login');
  };

  // Helper: obtener id y nombre del admin actual
  const getAdminInfo = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    let name = user?.email || 'Admin';
    const { data } = await supabase.from('profiles').select('full_name').eq('id', user?.id).single();
    if (data?.full_name) name = data.full_name;
    return { id: user?.id as string | undefined, name };
  };

  // ✅ FUNCIONES PARA ALERTAS DE VENCIMIENTO
  const getDaysUntilExpiry = (dateString?: string) => {
      if (!dateString) return null;
      const expiry = new Date(dateString);
      const today = new Date();
      expiry.setHours(0, 0, 0, 0);
      today.setHours(0, 0, 0, 0);
      return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 3600 * 24));
  };

  const expiringCount = dataList.filter(item => {
      if (item.status !== 'active') return false;
      const days = getDaysUntilExpiry(item.license_expiry);
      return days !== null && days <= 15;
  }).length;

  const filteredList = dataList.filter(item => 
    item.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* --- HEADER --- */}
      <header className="bg-slate-900 text-white shadow-lg sticky top-0 z-10 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 h-16 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-red-600 to-red-700 p-2 rounded-lg shadow-lg shadow-red-900/50">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-none">BISNE CON TALLA ADMIN</h1>
              <p className="text-[10px] text-slate-400 font-medium tracking-wide uppercase">Panel Maestro</p>
            </div>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg text-xs font-bold transition-all border border-slate-700 hover:border-slate-600">
            <LogOut size={16} /> <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      {/* --- CONTENIDO PRINCIPAL --- */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-8 space-y-6">
        
        {/* BARRA DE HERRAMIENTAS */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="bg-white p-1 rounded-xl shadow-sm border border-slate-200 grid grid-cols-4 sm:flex w-full sm:w-auto gap-0.5 sm:gap-0">
                <button
                    onClick={() => setActiveTab('requests')}
                    className={`flex items-center justify-center gap-1.5 px-3 sm:px-5 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${activeTab === 'requests' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                    <Inbox size={14} className="sm:w-4 sm:h-4" /> <span className="hidden sm:inline">Solicitudes</span><span className="sm:hidden">Solic.</span>
                </button>
                <button
                    onClick={() => setActiveTab('active')}
                    className={`relative flex items-center justify-center gap-1.5 px-3 sm:px-5 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${activeTab === 'active' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                    <UserCheck size={14} className="sm:w-4 sm:h-4" /> <span className="hidden sm:inline">Clientes</span><span className="sm:hidden">Client.</span>
                    {expiringCount > 0 && (
                        <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full animate-pulse border-2 border-white shadow-sm">
                            {expiringCount}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`flex items-center justify-center gap-1.5 px-3 sm:px-5 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${activeTab === 'history' ? 'bg-violet-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                    <History size={14} className="sm:w-4 sm:h-4" /> <span className="hidden sm:inline">Historial</span><span className="sm:hidden">Hist.</span>
                </button>
                <button
                    onClick={() => setActiveTab('billing')}
                    className={`flex items-center justify-center gap-1.5 px-3 sm:px-5 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${activeTab === 'billing' ? 'bg-emerald-700 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                    <DollarSign size={14} className="sm:w-4 sm:h-4" /> Cobros
                </button>
            </div>

            {activeTab !== 'history' && (
                <div className="relative w-full sm:w-96 group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 group-focus-within:text-indigo-500 transition-colors"/>
                    <input
                        type="text"
                        placeholder="Buscar por nombre, email o teléfono..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none shadow-sm transition-all text-sm font-medium"
                    />
                </div>
            )}
        </div>

        {/* ===== PESTAÑA COBROS ===== */}
        {activeTab === 'billing' && (
          <div className="space-y-4">
            {/* Cabecera: período + totales */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <label className="text-xs sm:text-sm font-bold text-slate-600">Período:</label>
                <input
                  type="month"
                  value={billingPeriod}
                  onChange={e => { setBillingPeriod(e.target.value); fetchBilling(e.target.value); }}
                  className="border border-slate-200 rounded-lg px-2 sm:px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500 bg-white flex-1 sm:flex-none min-w-0"
                />
                <button
                  onClick={() => fetchBilling(billingPeriod)}
                  className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors flex-shrink-0"
                  title="Actualizar"
                >
                  <RefreshCw size={18} className={billingLoading ? 'animate-spin' : ''} />
                </button>
              </div>
              {billingRows.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xs text-slate-400 font-medium">Negocios</p>
                      <p className="text-lg font-black text-slate-700">{billingRows.length}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 font-medium">Total ventas</p>
                      <p className="text-lg font-black text-emerald-700">${billingRows.reduce((s,r)=>s+r.total_sales,0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 font-medium">A cobrar</p>
                      <p className="text-lg font-black text-amber-600">${billingRows.reduce((s,r)=>s+r.fee,0).toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 text-[10px] font-bold">
                    <span className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-lg">
                      <Zap size={10}/> Estándar (≤$500k): {billingRows.filter(r=>r.tier==='standard').length} negocio(s) · 1%
                    </span>
                    <span className="flex items-center gap-1 px-2 py-1 bg-violet-50 text-violet-700 rounded-lg">
                      <Star size={10} className="fill-violet-600"/> Plus (&gt;$500k): {billingRows.filter(r=>r.tier==='plus').length} negocio(s) · 0.5%
                    </span>
                  </div>
                </div>
              )}
            </div>

            {billingLoading ? (
              <div className="flex justify-center py-16"><RefreshCw className="animate-spin text-emerald-500" size={32}/></div>
            ) : billingRows.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center text-slate-400 border border-slate-100">
                <DollarSign size={40} className="mx-auto mb-3 opacity-30"/>
                <p className="font-bold">No hay negocios activos</p>
              </div>
            ) : (
              <div className="space-y-3">
                {billingRows.map(row => {
                  const paid = isPaid(row);
                  return (
                    <div key={row.business_id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${paid ? 'border-emerald-100' : row.total_sales > 0 ? 'border-amber-200' : 'border-slate-100'}`}>
                      {/* Fila superior: nombre + estado + tier */}
                      <div className={`flex items-center justify-between px-4 py-3 ${paid ? 'bg-emerald-50/60' : row.total_sales > 0 ? 'bg-amber-50/60' : 'bg-slate-50/60'}`}>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-black text-slate-800 text-sm">{row.business_name}</p>
                            {row.tier === 'plus' ? (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full text-[10px] font-black uppercase">
                                <Star size={9} className="fill-violet-600"/> Plus 0.5%
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-black uppercase">
                                <Zap size={9}/> Estándar 1%
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400">{row.owner_name}</p>
                        </div>
                        <div>
                          {paid ? (
                            <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-black uppercase">
                              <CheckCircle2 size={12}/> Pagado
                            </span>
                          ) : row.total_sales === 0 ? (
                            <span className="inline-flex px-3 py-1 bg-slate-100 text-slate-400 rounded-full text-xs font-bold uppercase">Sin ventas</span>
                          ) : (
                            <span className="inline-flex px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-black uppercase">Pendiente</span>
                          )}
                        </div>
                      </div>

                      {/* Fila inferior: métricas + acciones */}
                      <div className="px-4 py-3">
                        <div className="grid grid-cols-3 gap-2 mb-3">
                          {/* Ventas */}
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Ventas</p>
                            <p className="font-black text-slate-700 text-sm font-mono">${row.total_sales.toFixed(2)}</p>
                          </div>

                          {/* % auto-detectado */}
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">% Cobro</p>
                            <div className="flex items-center gap-1">
                              <span className={`px-2 py-1 rounded-lg font-black text-sm ${row.tier === 'plus' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
                                {row.rate}%
                              </span>
                              <span className="text-[9px] text-slate-400 font-bold">AUTO</span>
                            </div>
                          </div>

                          {/* Monto a pagar */}
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">A pagar</p>
                            <p className={`font-black text-base font-mono ${row.fee > 0 ? 'text-emerald-700' : 'text-slate-300'}`}>${row.fee.toFixed(2)}</p>
                          </div>
                        </div>

                        {/* Botón acción */}
                        <div className="flex justify-end">
                          {!paid && row.total_sales > 0 && (
                            <button
                              onClick={() => handleMarkPaid(row)}
                              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all active:scale-95 shadow-sm flex items-center gap-1.5 w-full sm:w-auto justify-center"
                            >
                              <CheckCircle2 size={13}/> Confirmar pago
                            </button>
                          )}
                          {paid && (
                            <button
                              onClick={() => handleRevertPaid(row)}
                              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                            >
                              Revertir
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ===== PESTAÑA HISTORIAL ===== */}
        {activeTab === 'history' && (
          <div className="space-y-5">
            {/* Filtros de período */}
            <div className="flex items-center gap-2 flex-wrap">
              {([['day','Hoy'], ['week','Esta semana'], ['month','Este mes'], ['year','Este año']] as [HistoryPeriod, string][]).map(([p, label]) => (
                <button
                  key={p}
                  onClick={() => setHistoryPeriod(p)}
                  className={`px-5 py-2 rounded-xl text-sm font-bold transition-all border ${historyPeriod === p ? 'bg-violet-600 text-white border-violet-600 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                >
                  {label}
                </button>
              ))}
              <button onClick={fetchHistory} className="ml-auto p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors" title="Actualizar">
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* Tarjetas de resumen */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4 shadow-sm">
                <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center">
                  <Award className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-800">{historyList.length}</p>
                  <p className="text-xs text-slate-400 font-medium">Eventos</p>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4 shadow-sm">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-800">
                    {historyList.reduce((sum, i) => sum + (i.months_granted || 0), 0)}
                  </p>
                  <p className="text-xs text-slate-400 font-medium">Meses otorgados</p>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4 shadow-sm col-span-2 sm:col-span-1">
                <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                  <UserCheck className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-800">
                    {new Set(historyList.map(i => i.performed_by_name).filter(Boolean)).size}
                  </p>
                  <p className="text-xs text-slate-400 font-medium">Admins activos</p>
                </div>
              </div>
            </div>

            {/* Tabla de historial */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[300px]">
              {loading ? (
                <div className="h-64 flex flex-col items-center justify-center text-slate-400">
                  <RefreshCw className="animate-spin w-8 h-8 mb-3 text-violet-500 opacity-50" />
                  <p className="text-sm font-medium">Cargando historial...</p>
                </div>
              ) : historyList.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-slate-400">
                  <History className="w-12 h-12 opacity-20 mb-3" />
                  <p className="text-sm font-medium">Sin eventos en este período</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-500 tracking-wider">
                        <th className="p-4">Fecha</th>
                        <th className="p-4">Evento</th>
                        <th className="p-4">Cliente</th>
                        <th className="p-4">Realizado por</th>
                        <th className="p-4 text-center">Meses</th>
                        <th className="p-4">Nueva Fecha</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {historyList.map(item => {
                        const eventConfig: Record<EventType, { label: string; classes: string }> = {
                          approval:       { label: 'Nueva Licencia', classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                          extension:      { label: 'Extensión',      classes: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                          suspension:     { label: 'Suspensión',     classes: 'bg-red-50 text-red-700 border-red-200' },
                          reactivation:   { label: 'Reactivación',   classes: 'bg-teal-50 text-teal-700 border-teal-200' },
                          password_reset: { label: 'Contraseña',     classes: 'bg-violet-50 text-violet-700 border-violet-200' },
                        };
                        const ev = eventConfig[item.event_type];
                        return (
                          <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-4">
                              <div className="text-xs font-bold text-slate-700">
                                {new Date(item.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                {new Date(item.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </td>
                            <td className="p-4">
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${ev.classes}`}>
                                {ev.label}
                              </span>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                                  {item.client_name.substring(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <div className="text-sm font-bold text-slate-800">{item.client_name}</div>
                                  <div className="text-[11px] text-slate-400">{item.client_email || '—'}</div>
                                </div>
                              </div>
                            </td>
                            <td className="p-4">
                              {item.performed_by_name ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-bold border border-indigo-100">
                                  <Shield size={10} /> {item.performed_by_name}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400 italic">—</span>
                              )}
                            </td>
                            <td className="p-4 text-center">
                              {item.months_granted ? (
                                <span className="inline-flex items-center justify-center w-8 h-8 bg-emerald-100 text-emerald-700 rounded-lg text-sm font-black">
                                  {item.months_granted}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="p-4">
                              <span className="text-xs font-medium text-slate-600">
                                {item.new_expiry_at ? new Date(item.new_expiry_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== PESTAÑAS SOLICITUDES / CLIENTES ===== */}
        {activeTab !== 'history' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[400px]">
            {loading ? (
                <div className="h-96 flex flex-col items-center justify-center text-slate-400">
                    <RefreshCw className="animate-spin w-10 h-10 mb-4 text-indigo-500 opacity-50" />
                    <p className="text-sm font-medium">Sincronizando datos...</p>
                </div>
            ) : filteredList.length === 0 ? (
                <div className="h-96 flex flex-col items-center justify-center text-slate-400">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-slate-100">
                        <Inbox className="w-10 h-10 opacity-30"/>
                    </div>
                    <p className="text-sm font-medium">No hay registros para mostrar</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-500 tracking-wider">
                                <th className="p-5 w-64">Negocio / Cliente</th>
                                <th className="p-5">Contacto</th>
                                <th className="p-5 text-center">Estado</th>
                                <th className="p-5">Detalles</th>
                                {activeTab === 'active' && <th className="p-5">Aprobado por</th>}
                                <th className="p-5 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredList.map((item) => {
                                const daysLeft = getDaysUntilExpiry(item.license_expiry);
                                const isExpiringSoon = item.status === 'active' && daysLeft !== null && daysLeft <= 15 && daysLeft >= 0;
                                const isExpired = item.status === 'active' && daysLeft !== null && daysLeft < 0;

                                return (
                                <tr key={item.id} className={`hover:bg-slate-50/50 transition-colors group ${isExpired ? 'bg-red-50/30' : isExpiringSoon ? 'bg-orange-50/30' : ''}`}>
                                    <td className="p-5">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm ${item.business_id ? 'bg-indigo-600' : 'bg-slate-400'}`}>
                                                {item.full_name.substring(0,2).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="font-bold text-slate-800 text-sm">{item.full_name}</div>
                                                <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wide flex items-center gap-1 mt-0.5">
                                                    {item.business_id ? (
                                                        <><Store size={10} className="text-emerald-500"/> Negocio Activo</>
                                                    ) : (
                                                        <><AlertTriangle size={10} className="text-amber-500"/> Sin Asignar</>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-5">
                                        <div className="flex flex-col gap-1">
                                            <div className="text-xs font-bold text-slate-600 flex items-center gap-2">
                                                <User size={12} className="text-slate-400"/> {item.email || 'N/A'}
                                            </div>
                                            <div className="text-xs text-slate-500 pl-5">
                                                {item.phone || 'Sin teléfono'}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-5 text-center">
                                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                                            item.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                            item.status === 'pending' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                                            'bg-red-50 text-red-700 border-red-200'
                                        }`}>
                                            {item.status === 'active' ? 'ACTIVO' :
                                             item.status === 'pending' ? 'PENDIENTE' : item.status}
                                        </span>
                                    </td>
                                    <td className="p-5">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                                                <Key size={12} className="text-slate-400"/> PIN: <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-700">{item.initial_pin}</span>
                                            </div>
                                            <div className="text-xs flex items-center gap-2 mt-1">
                                                <Calendar size={12} className={isExpired ? 'text-red-500' : isExpiringSoon ? 'text-orange-500' : 'text-slate-400'}/>
                                                <span className={isExpired ? 'text-red-600 font-bold' : isExpiringSoon ? 'text-orange-600 font-bold' : 'text-slate-500'}>
                                                    {item.license_expiry
                                                        ? (isExpired ? `¡Venció hace ${Math.abs(daysLeft!)} días!` : isExpiringSoon ? `¡Vence en ${daysLeft} días!` : `Vence: ${new Date(item.license_expiry).toLocaleDateString()}`)
                                                        : `Solicita: ${item.months_requested} Mes(es)`}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    {activeTab === 'active' && (
                                        <td className="p-5">
                                            {item.approved_by_name ? (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-bold border border-indigo-100 whitespace-nowrap">
                                                    <Shield size={10} /> {item.approved_by_name}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-slate-400 italic">—</span>
                                            )}
                                        </td>
                                    )}
                                    <td className="p-5 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {activeTab === 'requests' ? (
                                                <>
                                                    <button
                                                        onClick={() => { setApprovingItem(item); setMonthsToGrant(item.months_requested || 1); setAdminPin('1234'); }}
                                                        className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg shadow-sm transition-colors text-xs font-bold"
                                                    >
                                                        <Check size={14} /> Aprobar
                                                    </button>
                                                    <button
                                                        onClick={() => handleGrantTrial(item)}
                                                        className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg shadow-sm transition-colors text-xs font-bold"
                                                        title="Dar 7 días de prueba gratuita"
                                                    >
                                                        <FlaskConical size={14} /> Prueba
                                                    </button>
                                                    <button
                                                        onClick={() => setConfirmModal({ type: 'delete', item })}
                                                        className="flex items-center gap-1 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-slate-500 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold"
                                                    >
                                                        <X size={14} /> Rechazar
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => { setExtendingItem(item); setExtendMonths(1); }}
                                                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                                        title="Extender Licencia"
                                                    >
                                                        <CalendarPlus size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleGrantTrial(item)}
                                                        className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                                                        title="Dar Prueba 7 días"
                                                    >
                                                        <FlaskConical size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => { setResetPasswordItem(item); setNewPassword(''); setShowNewPassword(false); }}
                                                        className="p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
                                                        title="Restablecer Contraseña"
                                                    >
                                                        <KeyRound size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => setConfirmModal({ type: 'suspend', item })}
                                                        className={`p-2 rounded-lg transition-colors ${item.status === 'active' ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50' : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'}`}
                                                        title={item.status === 'active' ? "Suspender Cuenta" : "Reactivar Cuenta"}
                                                    >
                                                        {item.status === 'active' ? <UserCheck size={18} /> : <Check size={18} />}
                                                    </button>
                                                    <button
                                                        onClick={() => setConfirmModal({ type: 'delete', item })}
                                                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                        title="Eliminar Definitivamente"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
        )}
      </main>

      {/* ================= MODALES ================= */}

      {/* 1. MODAL DE APROBACIÓN */}
      {approvingItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="p-6 bg-indigo-50 border-b border-indigo-100">
                    <h3 className="text-lg font-black text-indigo-900 flex items-center gap-2">
                        <Check className="w-5 h-5 text-indigo-600"/> APROBAR CLIENTE
                    </h3>
                    <p className="text-xs text-indigo-600 mt-1 font-medium">{approvingItem.full_name}</p>
                </div>
                
                <div className="p-6 space-y-5">
                    {/* Duración */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Duración Licencia</label>
                        <div className="grid grid-cols-4 gap-2 mb-2">
                            {[1, 3, 6, 12].map(m => (
                                <button key={m} onClick={() => setMonthsToGrant(m)} className={`py-2 text-xs font-bold rounded-lg border transition-all ${monthsToGrant === m ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'}`}>
                                    {m}M
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* PIN Maestro */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">PIN Maestro de Seguridad</label>
                        <div className="relative">
                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                            <input
                                type="text" maxLength={4}
                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-lg font-bold text-slate-800 tracking-widest outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-50 transition-all text-center"
                                value={adminPin}
                                onChange={(e) => setAdminPin(e.target.value.replace(/\D/g,''))}
                                placeholder="1234"
                            />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1.5 text-center">Para retiros, anulaciones y acceso al POS. El cliente puede cambiarlo luego.</p>
                    </div>

                    {/* Acciones */}
                    <div className="flex gap-3 pt-2">
                        <button onClick={() => setApprovingItem(null)} className="flex-1 py-3 text-slate-500 font-bold bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-xs">CANCELAR</button>
                        <button onClick={executeApproval} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 transition-all text-xs">CONFIRMAR</button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* 2. MODAL DE EXTENSIÓN */}
      {extendingItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="p-6 bg-emerald-50 border-b border-emerald-100">
                    <h3 className="text-lg font-black text-emerald-900 flex items-center gap-2">
                        <CalendarPlus className="w-5 h-5 text-emerald-600"/> EXTENDER LICENCIA
                    </h3>
                    <p className="text-xs text-emerald-600 mt-1 font-medium">{extendingItem.full_name}</p>
                </div>
                
                <div className="p-6 space-y-6">
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Meses a Añadir</label>
                        <div className="flex items-center justify-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                            <button onClick={() => setExtendMonths(Math.max(1, extendMonths - 1))} className="w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm border border-slate-200 text-slate-600 hover:text-emerald-600 font-bold">-</button>
                            <span className="text-2xl font-bold text-slate-800 w-16 text-center">{extendMonths}</span>
                            <button onClick={() => setExtendMonths(extendMonths + 1)} className="w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm border border-slate-200 text-slate-600 hover:text-emerald-600 font-bold">+</button>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <button onClick={() => setExtendingItem(null)} className="flex-1 py-3 text-slate-500 font-bold bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-xs">CANCELAR</button>
                        <button onClick={executeExtension} className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-200 transition-all text-xs">APLICAR</button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* 3. MODAL DE RESTABLECER CONTRASEÑA */}
      {resetPasswordItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="p-6 bg-violet-50 border-b border-violet-100">
                    <h3 className="text-lg font-black text-violet-900 flex items-center gap-2">
                        <KeyRound className="w-5 h-5 text-violet-600"/> RESTABLECER CONTRASEÑA
                    </h3>
                    <p className="text-xs text-violet-600 mt-1 font-medium">{resetPasswordItem.full_name}</p>
                    <p className="text-[11px] text-violet-400 mt-0.5">{resetPasswordItem.email}</p>
                </div>

                <div className="p-6 space-y-5">
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Nueva Contraseña</label>
                        <div className="relative">
                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                            <input
                                type={showNewPassword ? 'text' : 'password'}
                                className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-base font-bold text-slate-800 tracking-widest outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="mínimo 6 caracteres"
                                autoFocus
                            />
                            <button
                                type="button"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1.5">El cliente deberá usar esta contraseña en su próximo inicio de sesión.</p>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={() => { setResetPasswordItem(null); setNewPassword(''); setShowNewPassword(false); }}
                            className="flex-1 py-3 text-slate-500 font-bold bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-xs"
                        >
                            CANCELAR
                        </button>
                        <button
                            onClick={executeResetPassword}
                            disabled={loading}
                            className="flex-1 py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg shadow-violet-200 transition-all text-xs"
                        >
                            {loading ? 'GUARDANDO...' : 'CONFIRMAR'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* 4. MODAL DE CONFIRMACIÓN (Suspensión / Eliminación) */}
      {confirmModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border-t-4 border-red-500">
                <div className="p-8 text-center">
                    <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertOctagon className="w-8 h-8 text-red-500" />
                    </div>
                    <h3 className="text-xl font-black text-slate-800 mb-2">
                        {confirmModal.type === 'delete' ? '¿ELIMINAR USUARIO?' : '¿CAMBIAR ESTADO?'}
                    </h3>
                    <p className="text-sm text-slate-500 mb-6">
                        {confirmModal.type === 'delete' 
                            ? <>Estás a punto de borrar permanentemente a <strong>{confirmModal.item.full_name}</strong>. Esta acción no se puede deshacer.</>
                            : <>Estás a punto de {confirmModal.item.status === 'active' ? 'suspender' : 'reactivar'} el acceso de <strong>{confirmModal.item.full_name}</strong>.</>
                        }
                    </p>

                    <div className="flex gap-3">
                        <button onClick={() => setConfirmModal(null)} className="flex-1 py-3 text-slate-600 font-bold bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors text-xs">
                            CANCELAR
                        </button>
                        <button onClick={executeConfirmAction} className={`flex-1 py-3 text-white font-bold rounded-xl shadow-lg transition-all text-xs ${confirmModal.type === 'delete' ? 'bg-red-600 hover:bg-red-700 shadow-red-200' : 'bg-slate-800 hover:bg-black'}`}>
                            {confirmModal.type === 'delete' ? 'SÍ, ELIMINAR' : 'CONFIRMAR'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

    </div>
  );
}