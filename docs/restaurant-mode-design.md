# Modo Restaurante — Diseño de arquitectura (propuesta)

> Estado: **propuesta para revisión** (aún no implementado). Documento de diseño para
> discutir antes de escribir código. El alcance v1 fue confirmado; la implementación
> será por fases, cada una detrás del flag `business_type` para no afectar el modo retail.

## 1. Contexto y objetivo

Nexus POS hoy opera en modo "retail" (venta de productos con stock). Queremos añadir un
**modo restaurante** activable por negocio que cubra el flujo de un restaurante real:
mesas con órdenes abiertas, envío a cocina, modificadores de platos, dividir cuenta,
propinas e inventario por recetas (descuento de ingredientes).

Principio rector: **reutilizar los patrones ya probados** (cola offline `action_queue`,
`process_sale_transaction`, `safeBulkPut`/`shouldOverwriteLocal`, turnos y finanzas) en
lugar de reinventar. El modo restaurante se enchufa sobre la infraestructura existente.

### Alcance v1 (confirmado)
1. **Mesas + comandas**: plano de salón con estados (libre/ocupada/por cobrar/reservada),
   asignación de mesero, áreas (salón/terraza/barra) y orden abierta por mesa que crece en rondas.
2. **KDS (Kitchen Display System) en otro dispositivo**: los ítems enviados a cocina aparecen
   en una pantalla de cocina vía sync; cocina marca preparando/listo. Requiere baja latencia.
3. **Modificadores estructurados con precio**: grupos configurables por plato (p.ej. "Término":
   vuelta y vuelta/medio/bien; "Extras": +queso $X) aplicados por línea de comanda.
4. **Dividir cuenta + propinas**: dividir la cuenta (por ítem o en partes iguales) y registrar
   propina asignada al mesero.
5. **Inventario por recetas**: cada plato define ingredientes (lista de materiales); al cobrarse
   descuenta el stock de ingredientes atómicamente.
6. Un toggle `business_type: 'retail' | 'restaurant'` controla todo el modo.

## 2. Decisiones de arquitectura clave

1. **La comanda NO reutiliza `ParkedOrder`.** `ParkedOrder` (`src/lib/db.ts`) no se sincroniza
   (sin `sync_status`, sin tipo de cola) y embebe los ítems en una sola fila. Una comanda es
   **larga y mutada por dos dispositivos a la vez** (el mesero agrega rondas, la cocina cambia el
   estado de un ítem). Embeber todo en una fila provoca *last-writer-wins* y se pierden cambios.
   → **header (`comandas`) + una fila por línea (`comanda_items`)**: concurrencia a nivel de ítem.

2. **Propiedad de columnas disjunta** (clave para no perder updates). El mesero posee
   `{quantity, price, custom_price, note, modifiers, voided}`; la cocina (KDS) posee
   `{kitchen_status, sent_at, ready_at}`. Cada dispositivo escribe por un RPC que **solo toca sus
   columnas**, así nunca se pisan — sin necesidad de CRDTs. Pivote de merge: `item_updated_at` por línea.

3. **KDS en tiempo real con Supabase Realtime** (hoy no se usa en el proyecto) cuando hay conexión,
   con el **poll de 30s como respaldo offline**. Las escrituras siguen yendo por la cola offline
   (`action_queue`); Realtime es **solo lectura** (recibir cambios). Si el socket cae, la cocina no
   se cuelga: converge en 30s. Preserva el offline-first.

4. **La comanda se cierra en 1 o N ventas**, reutilizando el pipeline existente: sin split → 1
   `Sale`; con split → N `Sale` con `split_group_id` compartido. Cada `Sale` pasa por el RPC
   existente, así que finanzas, turnos y reportes se reutilizan al 100%.

5. **Modificadores: config en filas, aplicados embebidos.** Los grupos/modificadores del menú son
   tablas (se editan en Ajustes); lo elegido en una línea se guarda como snapshot embebido en
   `comanda_items.modifiers` con el precio congelado. Al cobrar, el total del modificador se pliega
   en `custom_price` para que la matemática de dinero existente no cambie.

6. **Recetas reutilizan la tabla `Product`.** Los ingredientes son productos que no van al menú
   (flag `is_ingredient`). No hay tabla nueva de producto.

## 3. Modelo de datos

Convención común a todas las tablas nuevas: cada fila tiene `id uuid`, `business_id uuid`,
`created_at`, `updated_at` (mantenido por el servidor, usado por `fetchSince`) y un `sync_status`
local. Todo entra en un bloque **Dexie v13** (`this.version(13).stores({...})` en `src/lib/db.ts`)
y en tablas Supabase paralelas.

### 3.1 Áreas (salones)
```ts
export interface RestaurantArea {
  id: string; business_id: string;
  name: string;              // "Salón", "Terraza", "Barra"
  sort_order?: number;
  deleted_at?: string | null;
  created_at?: string; updated_at?: string;
  sync_status: 'synced' | 'pending_create' | 'pending_update' | 'pending_delete';
}
```
Dexie: `restaurant_areas: 'id, business_id, sync_status, [business_id+sync_status]'`

### 3.2 Mesas
```ts
export interface RestaurantTable {
  id: string; business_id: string; area_id: string;
  name: string;              // "Mesa 4"
  capacity?: number;
  pos_x?: number; pos_y?: number;        // coordenadas en el plano
  state: 'libre' | 'ocupada' | 'por_cobrar' | 'reservada';
  current_comanda_id?: string | null;    // puntero denormalizado a la comanda abierta
  assigned_staff_id?: string | null;     // mesero
  deleted_at?: string | null;
  created_at?: string; updated_at?: string;
  sync_status: 'synced' | 'pending_create' | 'pending_update' | 'pending_delete';
}
```
Dexie: `restaurant_tables: 'id, business_id, area_id, state, sync_status, [business_id+state], [business_id+sync_status]'`

> **Decisión — `state` es derivado, no autoritativo.** La verdad de "ocupada" es la existencia de
> una comanda `open`. Ante conflicto de sync se **recalcula** `state` desde las comandas, en vez de
> confiar en el enum (evita que dos dispositivos peleen por el valor).

### 3.3 Comanda (header) + líneas
```ts
export interface Comanda {                 // header
  id: string; business_id: string;
  table_id: string; area_id: string;
  staff_id?: string;          // mesero que la abrió
  customer_id?: string;
  opened_at: string;
  status: 'open' | 'por_cobrar' | 'closed' | 'cancelled';
  closed_at?: string;
  guests?: number;            // comensales (para split igualitario)
  note?: string;
  total?: number; tip_total?: number;     // se completan al cerrar
  sale_ids?: string[];        // Sale(s) producidas al cerrar (split → varias)
  created_at?: string; updated_at?: string;
  sync_status: 'synced' | 'pending_create' | 'pending_update';
}

export interface ComandaItem {             // una fila por línea
  id: string; comanda_id: string;
  business_id: string;        // denormalizado para RLS + fetchSince
  product_id: string;
  name: string;               // snapshot
  quantity: number;
  price: number;              // precio unitario base (snapshot)
  custom_price?: number;      // semántica de SaleItem
  note?: string;              // semántica de SaleItem.note ("sin cebolla")
  modifiers?: ComandaItemModifier[];   // EMBEBIDO (ver 3.4)
  modifiers_total?: number;            // Σ price_delta * qty, cacheado
  course?: number;            // ronda/tiempo (opcional)
  kitchen_status: 'pending' | 'sent' | 'preparando' | 'listo' | 'served' | 'cancelled';
  sent_at?: string; ready_at?: string;
  voided?: boolean;
  item_updated_at?: string;   // updated_at POR ÍTEM — pivote de concurrencia (ver §4)
  created_at?: string; updated_at?: string;
  sync_status: 'synced' | 'pending_create' | 'pending_update';
}
```
Dexie:
```
comandas:       'id, business_id, table_id, status, sync_status, [business_id+status], [business_id+sync_status]'
comanda_items:  'id, comanda_id, business_id, kitchen_status, sync_status, [comanda_id+sync_status], [business_id+kitchen_status]'
```
El índice `[business_id+kitchen_status]` es el que consulta el **KDS** (ítems `sent`/`preparando`
de todas las comandas abiertas) de forma barata.

### 3.4 Modificadores
**(a) Configuración del menú** (estable, se edita en Ajustes) → filas relacionales:
```ts
export interface ModifierGroup {
  id: string; business_id: string;
  name: string;               // "Término", "Extras"
  min_select?: number; max_select?: number;   // 1/1 = única opción; 0/N = múltiple
  required?: boolean;
  deleted_at?: string | null; updated_at?: string; sync_status: /*…*/;
}
export interface Modifier {
  id: string; business_id: string; group_id: string;
  name: string;               // "Bien cocido", "+Queso"
  price_delta: number;        // 0, o +X
  sort_order?: number;
  deleted_at?: string | null; updated_at?: string; sync_status: /*…*/;
}
export interface ProductModifierGroup {   // qué grupos aplican a qué plato
  id: string; business_id: string;
  product_id: string; group_id: string;
  sort_order?: number; sync_status: /*…*/;
}
```
Dexie:
```
modifier_groups:          'id, business_id, sync_status, [business_id+sync_status]'
modifiers:                'id, business_id, group_id, sync_status, [group_id], [business_id+sync_status]'
product_modifier_groups:  'id, business_id, product_id, group_id, sync_status, [business_id+product_id]'
```

**(b) Modificadores aplicados** (lo elegido en una línea) → **snapshot embebido** en `ComandaItem.modifiers`:
```ts
export interface ComandaItemModifier {
  group_id: string; group_name: string;     // snapshot
  modifier_id: string; modifier_name: string;
  price_delta: number;                       // snapshot al elegir
}
```
Razón: los modificadores aplicados son historia inmutable una vez elegidos, se leen siempre junto a
su línea, y deben sobrevivir a cambios posteriores del menú (precio congelado). Embeber evita una
tercera tabla hija sincronizada. Replica la estrategia de `SaleItem`.

Al cerrar la comanda, cada `ComandaItem` → un `SaleItem`, con `custom_price = price + modifiers_total`
y los nombres de modificadores en `note` (o un nuevo `SaleItem.modifiers?` opcional para que ticket y
reportes los rendericen). **Recomendación: añadir `modifiers?` opcional a `SaleItem`** pero computar el
total de línea en `custom_price` para que toda la matemática de dinero (`finalTotal`, descuentos) siga igual.

### 3.5 Recetas (lista de materiales)
```ts
export interface RecipeIngredient {
  id: string; business_id: string;
  dish_product_id: string;       // el Product vendible
  ingredient_product_id: string; // un Product con stock (ingrediente)
  quantity: number;              // consumo por 1 unidad de plato (fraccional)
  unit?: string;                 // snapshot para mostrar
  deleted_at?: string | null; updated_at?: string; sync_status: /*…*/;
}
```
Dexie: `recipe_ingredients: 'id, business_id, dish_product_id, ingredient_product_id, sync_status, [business_id+dish_product_id]'`

Reutiliza `Product` para platos e ingredientes. Añadir opcional `Product.is_ingredient?: boolean`
y/o `Product.tracks_recipe?: boolean` para filtrar el grid del POS.

### 3.6 Propinas y splits — sobre `Sale` (sin tabla nueva)
Propinas y splits son **hechos del momento del cobro**, registrados en las `Sale` resultantes (mantiene
el cuadre de caja en un solo lugar — ver §7). Extender `Sale` (aditivo):
```ts
// añadir a la interface Sale
tip_amount?: number;
tip_staff_id?: string;     // mesero acreditado con la propina
comanda_id?: string;       // back-reference a la comanda de origen
split_group_id?: string;   // UUID compartido por las N Sales de un split
split_index?: number;      // 1 de 3, etc.
```

> **Decisión — una comanda cierra en una O varias Sales.**
> - Sin split → exactamente una `Sale` (camino actual).
> - Con split → N `Sale` con `split_group_id`, cada una con su `payment_method`, `tip_amount` y
>   subconjunto de ítems (split por ítem) o total proporcional (split igualitario). Cada una es una
>   `Sale` inmutable que fluye por el `process_sale_transaction` **existente**.
> Reutiliza todo el pipeline de ventas, reportes y cuadre. Lo único nuevo en servidor es la
> **deducción por receta** y el **cierre idempotente** de comanda.

## 4. Sync y concurrencia

### 4.1 Nuevos tipos de cola (extender `QueueItem.type` + `QueuePayload` en `db.ts`)
| Tipo | Payload | Acción en `processItem` |
|---|---|---|
| `AREA_SYNC` | `RestaurantArea` | `upsert('restaurant_areas')` + guard 23505 |
| `TABLE_SYNC` | `RestaurantTable` | `upsert('restaurant_tables')` |
| `COMANDA_SYNC` | `Comanda` | `upsert('comandas')` |
| `COMANDA_ITEM_SYNC` | `ComandaItem` | RPC `upsert_comanda_item` (solo columnas del mesero) |
| `KITCHEN_STATUS` | `{ item_id, comanda_id, business_id, kitchen_status, item_updated_at }` | RPC `set_kitchen_status` |
| `MODIFIER_GROUP_SYNC` / `MODIFIER_SYNC` / `PRODUCT_MODIFIER_SYNC` | filas de config | `upsert(...)` |
| `RECIPE_SYNC` | `RecipeIngredient` | `upsert('recipe_ingredients')` |
| `COMANDA_CLOSE` | `{ comanda_id, sales: Sale[], business_id, idempotency_key }` | RPC `close_comanda` |

Cada caso replica el patrón de `PRODUCT_SYNC` (`{ sync_status, ...clean }`, `throwUnlessDuplicate`,
luego `db.<tabla>.update(id, { sync_status:'synced' })`). Añadir etiquetas al mapa `pendingBreakdown`
en `Layout.tsx` (~línea 218) y al mapa `labels` en `SettingsPage.tsx` (~línea 49).

### 4.2 Evitar updates perdidos (el problema central)
El header/línea (§3.3) ya aísla la mayor parte de la contención: el mesero escribe filas nuevas de
`comanda_items`; el KDS escribe el campo `kitchen_status` de filas existentes. Rara vez tocan la misma fila.

Para las filas que **ambos** pueden tocar (el mesero edita una línea mientras cocina la marca lista),
usar **`item_updated_at` por línea** como pivote:
- `safeBulkPut` ya preserva la fila local sucia y deja ganar al remoto más nuevo. Extender la
  comparación para `comanda_items` para usar `item_updated_at` (no el `updated_at` del header).
- **Reconciliación por columna del estado de cocina**: enrutar los cambios de cocina por el tipo de
  cola dedicado `KITCHEN_STATUS` → RPC `set_kitchen_status` que hace un `UPDATE ... SET kitchen_status=…,
  ready_at=… WHERE id=… AND item_updated_at <= new`. Nunca toca las columnas del mesero. El upsert del
  mesero (`upsert_comanda_item`) actualiza **solo** columnas del mesero. Conjuntos de columnas disjuntos.

> **Regla recomendada:** mesero posee `{quantity, price, custom_price, note, modifiers, voided}`;
> KDS posee `{kitchen_status, sent_at, ready_at}`. Propiedad disjunta = sin updates perdidos, sin CRDT.

### 4.3 Realtime vs poll de 30s (latencia del KDS)
30s es inaceptable para una cocina. **Recomendación: Supabase Realtime con conexión; poll de 30s como
respaldo offline.**
- Nuevo `src/lib/realtime.ts`: `supabase.channel('kds-'+businessId).on('postgres_changes',
  { event:'*', schema:'public', table:'comanda_items', filter:'business_id=eq.'+businessId }, handler)`.
  El handler hace `safeBulkPut` de la fila cambiada en Dexie; `useLiveQuery` re-renderiza el KDS al instante.
- Suscribirse **solo** a `comandas` y `comanda_items` (alta rotación), no a products/sales → volumen acotado.
- **Respaldo:** mantener `syncLiveData` trayendo comandas/comanda_items cada 30s (sección nueva, solo si
  `business_type==='restaurant'`), para que un KDS offline que reconecta converja y un evento Realtime
  perdido se auto-sane en 30s.
- **Tradeoffs:** Realtime añade un WebSocket persistente (batería/datos en tablets; la red de Cuba lo
  tirará seguido → auto-resuscribir en `online` y en error de canal). Cuota de Realtime acotada porque solo
  KDS + plano se suscriben y a dos tablas. Las **escrituras siguen yendo exclusivamente por la cola
  offline**; Realtime es pull-only → se preserva el offline-first.

### 4.4 Nuevos RPCs atómicos necesarios
- **Sí** para receta: `close_comanda` debe descontar stock de *ingredientes* (no del plato) en varios
  productos en una transacción, idempotente. `process_sale_transaction` descuenta el stock del producto
  vendido — granularidad equivocada para recetas.
- **Sí** para cocina: `set_kitchen_status` (por columna, guardado por `item_updated_at`).
- **Sí** para el mesero: `upsert_comanda_item` (solo columnas del mesero) para no pisar al KDS.

## 5. Servidor (Supabase)

Migración nueva: `supabase/migrations/<timestamp>_restaurant_mode.sql`.

**Tablas nuevas** (todas con `business_id uuid`, `updated_at timestamptz default now()`, trigger de
`updated_at` como las tablas existentes, y RLS):
`restaurant_areas`, `restaurant_tables`, `comandas`, `comanda_items`, `modifier_groups`, `modifiers`,
`product_modifier_groups`, `recipe_ingredients`.

**RLS** — replicar la política por `business_id` que usan `products`/`sales` en cada tabla:
```sql
CREATE POLICY <t>_tenant ON public.<t> FOR ALL TO authenticated
  USING (business_id = (SELECT business_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (business_id = (SELECT business_id FROM profiles WHERE id = auth.uid()));
```
Habilitar publicación Realtime para `comandas` y `comanda_items`
(`ALTER PUBLICATION supabase_realtime ADD TABLE …`).

**RPCs:**
1. `set_kitchen_status(p_item_id, p_business_id, p_status, p_item_updated_at)` — `SECURITY DEFINER`,
   actualiza solo columnas de cocina, guardado `WHERE item_updated_at <= p_item_updated_at`. Devuelve la fila.
2. `upsert_comanda_item(...)` — actualiza solo columnas del mesero (no `kitchen_status`).
3. `close_comanda(p_comanda_id, p_sales jsonb, p_business_id, p_idempotency_key)` — `SECURITY DEFINER`,
   patrón de `add_loyalty_points`:
   - Revisar `processed_mutations` por `p_idempotency_key` → si existe, devolver el resultado guardado.
   - Para cada ingrediente implicado: `UPDATE products SET stock = stock - (recipe.quantity * line.quantity)`
     por cada `recipe_ingredients` de cada plato. Si alguno quedaría negativo → devolver
     `{ conflict:true, conflict_items:[…] }` (mismo contrato que `process_sale_transaction`, que `sync.ts`
     y `Layout.tsx` ya manejan).
   - Insertar las N `Sale` (`ON CONFLICT (id) DO NOTHING`), poner `comandas.status='closed'`.
   - Registrar `idempotency_key` en `processed_mutations`.
   - Platos sin receta caen a descontar su propio `stock` (menús mixtos funcionan).

Patrón de idempotencia: ver `db-migrations/2026-05-13-idempotency.sql`.

## 6. UI / páginas / componentes

### 6.1 Gating con `business_type`
- Añadir `business_type?: 'retail' | 'restaurant'` a `BusinessConfig` (`db.ts`) y a la tabla `businesses`.
  Extender el `updateData` del caso `SETTINGS_SYNC` en `sync.ts` (~línea 184) y el `db.settings.put` de
  `syncCriticalData` (~línea 573) para que lo lleven.
- Leerlo con un hook (`useBusinessType()` sobre `db.settings`), por defecto `'retail'` → los tenants
  existentes no se ven afectados.

`src/App.tsx` — landing condicional:
```tsx
<Route path="/" element={businessType==='restaurant' ? <FloorMapPage/> : <PosPage/>} />
```
y registrar rutas de restaurante (`/mesas`, `/comanda/:id`, `/cocina`, sub-rutas de config) solo en
restaurante. `/` sigue funcionando para retail.

`src/components/Layout.tsx` — extender `menuItems` (~línea 272) con entradas gated por `business_type`
(`{ path:'/mesas', label:'Mesas', show: isRestaurant }`, `{ path:'/cocina', label:'Cocina', show: isRestaurant }`)
y ocultar la entrada retail `/` cuando es restaurante. El bottom-nav móvil (`.slice(0,4)`) las toma automático.

### 6.2 Páginas/componentes nuevos
- `src/pages/FloorMapPage.tsx` — plano de mesas por área, color por `state`, asignación de mesero;
  tocar una mesa → abrir/continuar su comanda.
- `src/pages/ComandaPage.tsx` — pantalla de orden de una mesa. Reutiliza el grid de productos y el UI de
  carrito de PosPage, pero escribe filas `comanda_items` en vez de `sessionStorage`. "Enviar a cocina" pone
  `kitchen_status:'sent'`. "Cobrar" → flujo split/pago.
- `src/pages/KdsPage.tsx` (`/cocina`) — `useLiveQuery` sobre `comanda_items` con
  `kitchen_status in ('sent','preparando')`, agrupados por mesa/tiempo; botones cambian estado vía la cola
  `KITCHEN_STATUS`. Suscribe Realtime en `src/lib/realtime.ts`.
- `src/components/ModifierPickerModal.tsx` — al añadir un plato con `product_modifier_groups`, presenta sus
  grupos (única/múltiple por min/max) y calcula `modifiers_total`.
- `src/components/SplitBillModal.tsx` — split por ítem (asigna cada `ComandaItem` a una sub-cuenta) y/o
  igualitario (por `guests`); matemática pura en `src/lib/splitBill.ts`.
- `src/components/PaymentModal.tsx` — **extender** para aceptar propina (monto o %) y selector de mesero →
  llena `Sale.tip_amount`/`tip_staff_id`. Usado por el cierre simple y el split.
- `src/pages/InventoryPage.tsx` — editor de **recetas** por plato (`RecipeIngredient`) y toggle
  "es ingrediente" en productos.
- `src/pages/SettingsPage.tsx` — toggle `business_type` en General; pestaña **Menú/Modificadores**
  (`modifier_groups`/`modifiers`/`product_modifier_groups`) y pestaña **Áreas/Mesas**. Patrón `activeTab` existente.

### 6.3 Flujo de cierre (ComandaPage → Sale, reusando PosPage)
Espejo de `handleCheckout` (PosPage ~línea 369): construir N `Sale` desde los ítems de la comanda (una, o
por grupo de split), correr la transacción Dexie local (descontar ingredientes localmente para feedback
instantáneo, marcar comanda cerrada), luego `addToQueue('COMANDA_CLOSE', { sales, comanda_id, idempotency_key })`.
El RPC del servidor re-descuenta de forma autoritativa y reconcilia conflictos como las ventas hoy.

## 7. Plan por fases (cada fase detrás de `business_type`, retail intacto)

### Fase 0 — Flag + andamiaje (bajo riesgo, primero)
- **Entidades:** `business_type` en `BusinessConfig`/`businesses`.
- **Archivos:** `db.ts` (bloque v13 + campo), `sync.ts` (`SETTINGS_SYNC` + `syncCriticalData`),
  `SettingsPage.tsx` (toggle), `App.tsx`/`Layout.tsx` (nav/landing condicional; rutas restaurante stub).
- **Servidor:** columna `business_type` en `businesses`.
- **Verificación:** el toggle cambia nav/landing; retail intacto. Test unitario del default de `useBusinessType`.

### Fase 1 — Núcleo usable: Mesas + Comandas + cobro→Sale (sin KDS, sin recetas, sin split) — RECOMENDADA para arrancar
- **Entidades:** `restaurant_areas`, `restaurant_tables`, `comandas`, `comanda_items` (solo `note`;
  campos de modifiers/kitchen_status presentes pero sin usar).
- **Archivos:** `FloorMapPage.tsx`, `ComandaPage.tsx`, admin de áreas/mesas en `SettingsPage.tsx`,
  stores v13 en `db.ts`, casos `AREA/TABLE/COMANDA/COMANDA_ITEM_SYNC` + `COMANDA_CLOSE` (cierre **simple** =
  deducción del stock del producto vía `process_sale_transaction`, una Sale).
- **Sync:** tipos de cola nuevos; pull de comandas/comanda_items en `syncLiveData` (restaurante, 30s — ok sin
  KDS aún); `safeBulkPut` reutilizado.
- **Servidor:** las 4 tablas + RLS; RPC `close_comanda` (idempotente, sin rama de receta aún).
- **Verificación:** unit tests de la matemática del total de comanda; integration test (extender mock de
  `sync.integration.test.ts`) de que `COMANDA_CLOSE` produce una Sale y vacía la cola. Manual: dos dispositivos
  en mesas distintas.

### Fase 2 — KDS + Realtime
- **Entidades:** activar `comanda_items.kitchen_status`, `item_updated_at`.
- **Archivos:** `KdsPage.tsx`, `src/lib/realtime.ts`, caso `KITCHEN_STATUS`, ruta `/cocina`.
- **Sync:** suscripción Realtime a `comanda_items`/`comandas`; respaldo 30s; regla de columnas disjuntas en
  `set_kitchen_status`.
- **Servidor:** RPC `set_kitchen_status`; habilitar publicación Realtime.
- **Verificación:** integration test de que `KITCHEN_STATUS` no pisa una edición concurrente del mesero
  (columnas disjuntas); chequeo manual de latencia con dos dispositivos; el guard `item_updated_at` rechaza
  escrituras viejas.

### Fase 3 — Modificadores estructurados
- **Entidades:** `modifier_groups`, `modifiers`, `product_modifier_groups`; embed `ComandaItem.modifiers`;
  `SaleItem.modifiers?`.
- **Archivos:** `ModifierPickerModal.tsx`, pestaña de menú/modificadores en `SettingsPage.tsx`, render de
  modificadores en `TicketModal.tsx`/KDS.
- **Sync:** casos `MODIFIER_GROUP/MODIFIER/PRODUCT_MODIFIER_SYNC`; los aplicados viajan embebidos en
  `COMANDA_ITEM_SYNC`.
- **Servidor:** 3 tablas de config + RLS.
- **Verificación:** unit tests de la matemática de precio (`price + Σ price_delta` → `custom_price`) y de la
  validación min/max.

### Fase 4 — Dividir cuenta + propinas
- **Entidades:** extensiones de `Sale` (`tip_amount`, `tip_staff_id`, `split_group_id`, `split_index`, `comanda_id`).
- **Archivos:** `SplitBillModal.tsx`, `src/lib/splitBill.ts` (puro), `PaymentModal.tsx` (propina + mesero),
  `close_comanda` produce N Sales.
- **Sync:** `COMANDA_CLOSE` lleva `Sale[]`; cada Sale fluye por el pipeline existente.
- **Servidor:** `close_comanda` inserta N ventas atómicamente.
- **Verificación:** **cobertura unitaria fuerte** de `splitBill.ts` (split igualitario con centavos de resto,
  split por ítem, interacción con impuestos/descuentos) y de la matemática de propina en el cuadre;
  integration test de que un split en 3 da 3 Sales con `split_group_id` y la cola se vacía.

### Fase 5 — Inventario por recetas
- **Entidades:** `recipe_ingredients`; `Product.is_ingredient`/`tracks_recipe`.
- **Archivos:** editor de recetas en `InventoryPage.tsx`, caso `RECIPE_SYNC`, rama de receta en `close_comanda`.
- **Servidor:** tabla `recipe_ingredients` + RLS; deducción por receta en `close_comanda` (cantidades
  fraccionales, contrato de conflicto de stock negativo reutilizado).
- **Verificación:** unit tests de deducción fraccional (`recipe.quantity * line.quantity`, política de
  redondeo) y del camino de conflicto (ingrediente quedaría negativo → `{conflict:true}` manejado como
  `stock_conflict`).

## 8. Riesgos y decisiones abiertas

1. **Stock fraccional de ingredientes.** `Product.stock` se usa hoy con semántica entera y guards
   `p.stock <= 0` por todo PosPage. Las recetas necesitan deducción fraccional (ej. 0.15 kg). Definir
   política de redondeo/precisión y confirmar que los chequeos de stock del grid (`product.stock > 0`) no
   rechacen ingredientes que también sean platos vendibles. Usar los helpers de `currency` (no float) en
   `close_comanda`.

2. **Split + pagos parciales + propinas en el cuadre de caja.** `shiftStats.ts` y los reportes suman
   `Sale.total`/`payment_method`. Las propinas **no** deben inflar los ingresos pero **sí** rastrearse por
   mesero; decidir si `tip_amount` se excluye del `total` (recomendado: campo separado, fuera de ingresos,
   en un reporte de propinas por mesero) y si las propinas en efectivo afectan el esperado de caja. Es el
   riesgo de corrección más sutil — meter la matemática en tests de `splitBill.ts`/`shiftStats.ts` antes del UI.

3. **Costo de Realtime y red inestable (Cuba).** El WebSocket persistente cae seguido; auto-resuscribir en
   `online`/error de canal y confiar en el respaldo de 30s para que la cocina nunca se cuelgue en silencio.
   Vigilar cuota de conexiones/mensajes de Realtime; limitar suscripciones a `comandas`+`comanda_items`. Un
   **KDS offline** debe poder cambiar estados a la `action_queue` y converger al reconectar — verificar que la
   propiedad de columnas disjunta también se sostiene offline.

4. **Matemática de modificadores vs descuentos.** Plegar `modifiers_total` en `custom_price` mantiene la
   lógica de descuentos funcionando, pero un descuento % aplicaría sobre líneas infladas por modificadores —
   confirmar si es el comportamiento deseado y fijarlo con tests (es fácil doble-contar o descontar un "+queso"
   sin querer).

5. **Corrección de concurrencia de comanda.** Todo el diseño depende de header/línea + propiedad de columnas
   disjunta + `item_updated_at` por ítem. Si algún camino de escritura hace un `upsert` de fila completa de
   `comanda_items`, pisará al otro dispositivo en silencio. Forzar que las escrituras de mesero y KDS pasen por
   sus RPCs por columna y afirmarlo en integration tests.

6. **Carreras del enum `state` de la mesa.** Tratar `state` como derivado de la existencia de comanda; nunca
   dejar que dos dispositivos peleen por el enum como autoritativo (recalcular en sync).

## 9. Archivos críticos
- `src/lib/db.ts` — stores Dexie v13, interfaces nuevas, extender `QueuePayload` + `QueueItem.type`,
  `BusinessConfig.business_type`, extensiones de `Sale`/`SaleItem`.
- `src/lib/sync.ts` — casos nuevos en `processItem`, pull de comandas/realtime en `syncLiveData`,
  `business_type` en `SETTINGS_SYNC`/`syncCriticalData`.
- `src/lib/realtime.ts` — **nuevo**, suscripciones Realtime del KDS/plano.
- `src/pages/PosPage.tsx` — plantilla `handleCheckout` para el cierre comanda→Sale.
- `src/App.tsx` y `src/components/Layout.tsx` — rutas/landing condicionales y `menuItems` por `business_type`.
- `supabase/migrations/<timestamp>_restaurant_mode.sql` — **nuevo**, 8 tablas + RLS +
  RPCs `set_kitchen_status`/`upsert_comanda_item`/`close_comanda`, siguiendo el patrón de idempotencia de
  `db-migrations/2026-05-13-idempotency.sql`.
