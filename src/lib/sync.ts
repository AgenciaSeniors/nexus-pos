import { db, type Product } from './db';
import { supabase } from './supabase';

// Helper para verificar conexión
const isOnline = () => navigator.onLine;

export async function syncPush() {
  if (!isOnline()) return;

  try {
    const businessId = localStorage.getItem('nexus_business_id');
    if (!businessId) return;

    // --------------------------------------------------------
    // 1. SINCRONIZAR PRODUCTOS (¡SIN SOBRESCRIBIR STOCK!)
    // --------------------------------------------------------
    const pendingProducts = await db.products
      .where('sync_status')
      .anyOf('pending_create', 'pending_update')
      .toArray();

    if (pendingProducts.length > 0) {
      for (const p of pendingProducts) {
        // Preparamos los datos base
        // ✅ CORRECCIÓN: Usamos Partial<Product> en lugar de 'any'
        const productPayload: Partial<Product> = {
          id: p.id,
          business_id: p.business_id,
          name: p.name,
          price: p.price,
          cost: p.cost,
          sku: p.sku,
          category: p.category,
          unit: p.unit,
          expiration_date: p.expiration_date
        };

        // 🛡️ LÓGICA ANTI-RACE CONDITION:
        // Solo enviamos el stock si es un producto NUEVO ('pending_create').
        // Si es una actualización ('pending_update'), NO enviamos el stock,
        // confiamos en que los 'movements' mantendrán el stock correcto en la nube.
        if (p.sync_status === 'pending_create') {
           productPayload.stock = p.stock;
        }

        const { error } = await supabase
          .from('products')
          .upsert(productPayload);

        if (!error) {
          await db.products.update(p.id, { sync_status: 'synced' });
        } else {
          console.error("Error sync product:", p.name, error);
        }
      }
    }

    // --------------------------------------------------------
    // 2. SINCRONIZAR MOVIMIENTOS DE INVENTARIO (CRÍTICO)
    // --------------------------------------------------------
    const pendingMovements = await db.movements
        .where('sync_status')
        .equals('pending_create')
        .toArray();

    if (pendingMovements.length > 0) {
        // Mapeamos para quitar campos locales internos si fuera necesario
        const movementsToPush = pendingMovements.map(m => ({
            id: m.id,
            business_id: m.business_id,
            product_id: m.product_id,
            qty_change: m.qty_change,
            reason: m.reason,
            created_at: m.created_at,
            staff_id: m.staff_id
        }));

        // Enviamos a Supabase
        // ALERTA: El Trigger SQL que creamos se ejecutará aquí automáticamente
        const { error } = await supabase.from('inventory_movements').insert(movementsToPush);

        if (!error) {
            // Si éxito, marcamos como synced localmente
            const ids = pendingMovements.map(m => m.id);
            await db.movements.where('id').anyOf(ids).modify({ sync_status: 'synced' });
        } else {
            console.error("Error sync movements:", error);
        }
    }

    // --------------------------------------------------------
    // 3. SINCRONIZAR VENTAS
    // --------------------------------------------------------
    const pendingSales = await db.sales
      .where('sync_status')
      .equals('pending_create')
      .toArray();

    if (pendingSales.length > 0) {
      
      // A. Preparamos las CABECERAS de las ventas
      const salesToPush = pendingSales.map(s => ({
        id: s.id,
        business_id: s.business_id,
        date: s.date,
        total: s.total,
        payment_method: s.payment_method,
        staff_id: s.staff_id,
        staff_name: s.staff_name,
        // Ya no enviamos 'items' como JSON a la columna antigua (o mandamos null)
      }));

      // B. Preparamos los ÍTEMS individuales (Desglose)
      const allSaleItems = pendingSales.flatMap(s => 
        s.items.map(item => ({
          sale_id: s.id,
          business_id: s.business_id,
          product_id: item.product_id, // Asegúrate que tu SaleItem tenga product_id
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          cost: item.cost || 0
        }))
      );

      // C. Enviamos en orden: Primero Ventas, luego Ítems
      const { error: salesError } = await supabase.from('sales').insert(salesToPush);

      if (!salesError) {
        // Solo si la cabecera se guardó, guardamos los ítems
        const { error: itemsError } = await supabase.from('sale_items').insert(allSaleItems);
        
        if (!itemsError) {
          // Si todo salió bien, marcamos como sincronizado
          const ids = pendingSales.map(s => s.id);
          await db.sales.where('id').anyOf(ids).modify({ sync_status: 'synced' });
        } else {
          console.error("Error sincronizando ítems de venta:", itemsError);
          // Opcional: Podrías borrar las ventas huérfanas si fallan los ítems, 
          // pero el retry del siguiente sync suele arreglarlo.
        }
      } else {
        console.error("Error sincronizando ventas:", salesError);
      }
    }

    // --------------------------------------------------------
    // 4. SINCRONIZAR CLIENTES
    // --------------------------------------------------------
    const pendingCustomers = await db.customers
      .where('sync_status')
      .anyOf('pending_create', 'pending_update')
      .toArray();

    if (pendingCustomers.length > 0) {
        for (const c of pendingCustomers) {
            const { error } = await supabase.from('customers').upsert({
                id: c.id,
                business_id: c.business_id,
                name: c.name,
                phone: c.phone,
                email: c.email,
                address: c.address,
                notes: c.notes
            });
            if(!error) {
                await db.customers.update(c.id, { sync_status: 'synced' });
            }
        }
    }

  } catch (error) {
    console.error("Error general de sincronización:", error);
  }
}

// Función para TRAER datos frescos (Pull)
// Esto es importante para corregir el stock local con el valor real del servidor
export async function syncPull() {
    if (!isOnline()) return;
    const businessId = localStorage.getItem('nexus_business_id');
    if (!businessId) return;

    // 1. Traer Productos (para actualizar Stock real calculado por el servidor)
    const { data: remoteProducts } = await supabase
        .from('products')
        .select('*')
        .eq('business_id', businessId);
    
    if (remoteProducts) {
        await db.transaction('rw', db.products, async () => {
            for (const p of remoteProducts) {
                const local = await db.products.get(p.id);
                // Solo actualizamos si localmente no tenemos cambios pendientes
                // para no sobrescribir el trabajo del usuario actual
                if (!local || local.sync_status === 'synced') {
                    // Usamos casting a any temporalmente si hay discrepancias de tipos estrictos
                    // o aseguramos que p cumple con Product
                    await db.products.put({ ...p, sync_status: 'synced' } as Product);
                }
            }
        });
    }
}