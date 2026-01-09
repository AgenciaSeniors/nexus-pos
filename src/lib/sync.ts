import { supabase } from './supabase';
import { db } from './db';

// 1. Función de BAJADA (Nube -> Local)
export async function syncPull() {
  console.log("🔄 Iniciando sincronización (Nube -> Local)...");

  try {
    // A. Verificamos si hay sesión activa
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    // B. Descargar PRODUCTOS (Esto ya lo tenías)
    const { data: cloudProducts, error } = await supabase
      .from('products')
      .select('*');

    if (error) throw error;

    if (cloudProducts && cloudProducts.length > 0) {
      await db.products.bulkPut(
        cloudProducts.map(p => ({
            ...p,
            sync_status: 'synced'
        }))
      );
    }

    // ============================================================
    //  AQUÍ ESTÁ LA PARTE NUEVA DEL PASO 3 (Configuración)
    // ============================================================
    
    // C.1. Buscamos el perfil del usuario para saber su business_id
    const { data: perfil } = await supabase
        .from('profiles')
        .select('business_id')
        .eq('id', session.user.id)
        .single();

    if (perfil) {
        // C.2. Buscamos los detalles de ese negocio en la nube
        const { data: business } = await supabase
            .from('businesses')
            .select('*')
            .eq('id', perfil.business_id)
            .single();

        if (business) {
            // C.3. Guardamos esos detalles en la base de datos LOCAL (Dexie)
            // Usamos un ID fijo 'my-business' porque solo guardamos 1 configuración
            await db.settings.put({
                id: 'my-business', 
                name: business.name,
                address: business.address,
                phone: business.phone,
                receipt_message: business.receipt_message
            });
            console.log("🏢 Configuración descargada y guardada en local.");
        }
    }
    // ============================================================

    console.log("✅ Pull (Bajada) completado.");

  } catch (error) {
    console.error("❌ Error en sincronización:", error);
  }
}

// 2. Función de SUBIDA (Local -> Nube) - (Esta se mantiene igual que antes)
export async function syncPush() {
  console.log("⬆️ Iniciando subida inteligente...");
  
  try {
    // 1. PRODUCTOS CREADOS
    const creados = await db.products.where('sync_status').equals('pending_create').toArray();
    if (creados.length > 0) {
      for (const p of creados) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { sync_status: _, ...data } = p;
        const { error } = await supabase.from('products').insert(data);
        if (!error) await db.products.update(p.id, { sync_status: 'synced' });
      }
    }

    // 2. PRODUCTOS ACTUALIZADOS
    const modificados = await db.products.where('sync_status').equals('pending_update').toArray();
    if (modificados.length > 0) {
      for (const p of modificados) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { sync_status: _, ...data } = p;
        const { error } = await supabase.from('products').update(data).eq('id', p.id); 
        if (!error) await db.products.update(p.id, { sync_status: 'synced' });
      }
    }

    // 3. PRODUCTOS ELIMINADOS
    const eliminados = await db.products.where('sync_status').equals('pending_delete').toArray();
    if (eliminados.length > 0) {
      for (const p of eliminados) {
        const { error } = await supabase.from('products').delete().eq('id', p.id);
        if (!error || error.code === 'PGRST116') {
          await db.products.delete(p.id);
        }
      }
    }

    // 4. VENTAS
    const ventas = await db.sales.where('sync_status').equals('pending').toArray();
    if (ventas.length > 0) {
      for (const v of ventas) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { sync_status: _, ...data } = v;
        const { error } = await supabase.from('sales').insert(data);
        if (!error) await db.sales.update(v.id, { sync_status: 'synced' });
      }
    }

    // 5. CONFIGURACIÓN DEL NEGOCIO (¡También la subimos si cambia!)
    const settings = await db.settings.get('my-business');
    if (settings) {
        // Obtenemos el business_id de nuevo para asegurar
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
             const { data: perfil } = await supabase.from('profiles').select('business_id').eq('id', session.user.id).single();
             if (perfil) {
                 await supabase.from('businesses').update({
                     name: settings.name,
                     address: settings.address,
                     phone: settings.phone,
                     receipt_message: settings.receipt_message
                 }).eq('id', perfil.business_id);
             }
        }
    }

    console.log("✅ Sincronización completada.");
    
  } catch (error) {
    console.error("❌ Error en Push:", error);
  }
}