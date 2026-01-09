import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { SettingsPage } from './pages/SettingsPage';
import { AuthGuard } from './components/AuthGuard';
// Importamos el Layout y las Páginas
import { Layout } from './components/Layout';
import { PosPage } from './pages/PosPage';
import { InventoryPage } from './pages/InventoryPage';
import { FinancePage } from './pages/FinancePage';

function Login() {
    // ... (Copia aquí tu mismo componente Login de antes, no ha cambiado) ...
    // Para ahorrar espacio en este mensaje, asumo que dejas el Login igual
    // Si lo borraste, avísame y te lo paso de nuevo.
    return <div>Componente Login...</div>; 
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Si no hay sesión, mostramos Login (Aquí deberías poner tu componente Login completo)
  if (!session) return <Login />; 

  return (
    <BrowserRouter>
    <AuthGuard>
      <Routes>
        <Route element={<Layout />}>
          {/* Aquí definimos qué componente sale en cada URL */}
          <Route path="/" element={<PosPage />} />
          <Route path="/inventario" element={<InventoryPage />} />
          <Route path="/finanzas" element={<FinancePage />} />
          <Route path="/configuracion" element={<SettingsPage />} />
        </Route>
      </Routes>
      </AuthGuard>
    </BrowserRouter>
  );
}