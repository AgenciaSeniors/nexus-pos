# Changelog

Todos los cambios notables de **Bisne con Talla / Nexus POS** se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el versionado
sigue [Semantic Versioning](https://semver.org/lang/es/).

---

## [Unreleased] — Auditoría de finanzas e inventario (2026-07-24)

Auditoría completa del flujo de números (reportes, caja, reembolsos, inventario, POS, división de cuenta, tickets) y corrección de todos los errores confirmados. **301 tests en verde** (71 nuevos); `tsc`/`eslint` con paridad exacta contra `main`.

### 🐛 Bugs corregidos — Reportes y caja
- **CRÍTICO — Las devoluciones parciales no se restaban de NINGÚN reporte**: una venta de $100 con $60 devueltos seguía contando $100 en Ingresos, Ganancia, Reporte Z, categorías, top productos y ficha del cliente. Nuevo `computeSaleNet(sale, periodEndMs)` en `salesStats.ts` que netea respetando la inmutabilidad histórica (una devolución posterior al cierre del periodo no altera su reporte).
- **CRÍTICO — Reporte de Día/Reporte Z en $0.00 para fechas viejas**: solo se cargaban 3 días (Día) o 30 (cierre) de ventas; elegir una fecha anterior mostraba ceros con total seguridad y sin aviso. Ahora la ventana de carga se ancla a la fecha seleccionada.
- **CRÍTICO — Encabezado del Reporte Z con el día anterior**: `new Date('YYYY-MM-DD')` se parsea como UTC; en Cuba (UTC-4/-5) el Z impreso llevaba la fecha equivocada. Anclado a medianoche local.
- **Promedio diario dividía entre un día de más** (rango de 7 días → dividía entre 8).
- **Ventas de 00:00–06:59 invisibles en "Ventas por Hora"** (el gráfico no sumaba el KPI); ahora todas las horas se incluyen.
- **Gráfico del turno desaparecía en turnos nocturnos** que cruzan medianoche (longitud negativa del arreglo).
- **El Cierre del Día heredaba el filtro de rango de "Reportes"**: el Z decía una fecha pero sumaba todo el rango.
- **`custom_price` ignorado** en ingresos por categoría/top productos (no cuadraban con Ingresos); el ingreso del Top-5 leía el mapa de categorías por nombre (casi siempre $0).
- **Diferencia del cierre de caja mostraba "-$0.00" en rojo** con un conteo exacto (residuo de float); igual la validación de fondos en retiros. Ahora usan resta a centavos (`currency.subtract`).
- **Métodos de pago desconocidos desaparecían del desglose** (las tarjetas no sumaban 100%); se agrupan con transferencia como en el Reporte Z.
- **CSV de ventas** ahora incluye columnas **Reembolsado** y **Total neto**.

### 🐛 Bugs corregidos — Reembolsos y anulaciones
- **CRÍTICO — El reembolso ignoraba los descuentos de la venta**: con 10% de descuento, devolver un ítem de $50 entregaba $50 en vez de $45. Nuevo `computeRefundQuote` que prorratea por los descuentos (manual + puntos) y nunca devuelve más de lo pagado.
- **CRÍTICO — Reembolso de venta mixta salía completo de la gaveta**: $100 pagados $40 efectivo + $60 transferencia y un reembolso de $80 sacaba $80 de caja. Nuevo `cashPortionOfRefund` que solo descuenta de efectivo la parte realmente cobrada en efectivo.
- **CRÍTICO — Devolución total descontaba dos veces del efectivo esperado** (la venta pasaba a anulada Y quedaba el movimiento de salida) → faltante fantasma al cierre.
- **CRÍTICO — Anular platos con receta restauraba el stock del plato** en vez de los ingredientes (que fue lo que se descontó al cobrar) → inventario fantasma del plato e ingredientes perdidos. Ahora restaura vía receta.
- **Anular venta con devoluciones previas del mismo turno** no compensaba los movimientos de salida ya registrados (sobrante fantasma); ahora emite el `IN` compensatorio prometido.
- **Líneas duplicadas del mismo producto** (restaurante, mismo plato con distintos modificadores): `computeVoidDelta` sobrescribía cantidades en vez de acumularlas → se devolvía stock/dinero de más o de menos. Ahora se agregan por producto.
- La devolución total ahora registra `voided_at`.

### 🐛 Bugs corregidos — Inventario
- **CRÍTICO — Sync offline perdía stock al reconectar**: la cola subía el stock ABSOLUTO (`PRODUCT_SYNC`) antes que ventas offline más antiguas cuyo RPC lo descuenta en el servidor → unidades perdidas permanentemente al vender y anular/ajustar sin conexión. Nuevo campo estable `enqueued_at` y `sortQueueForUpload` que impone el orden causal por producto (un `PRODUCT_SYNC` va tras las ventas más antiguas que tocan su producto, pero antes de ventas más nuevas por la FK); si la venta bloqueadora falla, el `PRODUCT_SYNC` se pospone.
- **Deriva de decimales en stock fraccionado** (`0.6000000000000001 kg` en pantalla/CSV/historial): todas las mutaciones de stock redondean a 3 decimales.
- **Ajustes/transferencias escribían el snapshot viejo del modal** (revertían ventas/syncs concurrentes): ahora releen el producto dentro de la transacción.
- **Historial por producto truncado por el límite global** de movimientos: ahora consulta por índice del producto.
- **Fechas de vencimiento corridas un día** en husos negativos (alertas y visualización): ancladas a medianoche local.
- **Platos con receta ya no disparan siempre la alerta de bajo stock** (su stock vive en los ingredientes).
- **Costo $0 renderizaba un "0" suelto** en la columna de precio de Inventario.

### 🐛 Bugs corregidos — POS, pagos y tickets
- **CRÍTICO — Dividir cuenta editable tras cobrar la primera parte**: bajar de 3 a 2 partes después de cobrar 1/3 cerraba la comanda cobrando menos que el total. La división queda fija tras el primer cobro, con totales congelados y aviso si la comanda cambia después.
- **CRÍTICO — Cobros de división de cuenta se perdían**: cerrar el modal o la app con cuentas cobradas descartaba los cobros (dinero en gaveta sin registro). El progreso se persiste por comanda (`lib/splitState.ts`) y se retoma al reabrir.
- **Editar la comanda con una división en curso queda BLOQUEADO** (agregar/quitar ítems, cambiar cantidad y el botón "Cobrar" completo): recalcularía totales ya cobrados a algunos comensales. Se muestra un banner y solo se permite "Retomar división". El bloqueo se levanta al completar o cancelar.
- **Puntos canjeables perdían un punto** por división en float (`total/0.10`: $8.20 → 81 pts en vez de 82); ahora en centavos.
- **Propina 10%/15%** redondeaba mal el medio centavo.
- **Ticket**: totales de línea y subtotal ahora usan la misma matemática de centavos que el cobro (sin desvíos de $0.01 con cantidades decimales).
- **"Total Gastado" de la ficha de cliente** descuenta las devoluciones parciales.

### ✨ Inventario multi-dispositivo
- **Las ventas ahora registran su movimiento de inventario** (`reason: 'sale'`, ingrediente si el plato tiene receta): el historial del producto explica por fin todas las bajas de stock.
- **Los movimientos de inventario se descargan del servidor** (antes eran push-only y cada dispositivo solo veía su propio historial): pull incremental por `created_at` cada 30s + carga inicial de 90 días en dispositivos nuevos/reinstalados.
- **Traslados vitrina↔almacén con insignia neutra** (azul, sin +/−) en el historial: el stock total no cambia en un traslado.

### ✅ Tests
- 71 tests nuevos: prorrateo de reembolsos y tope por lo pagado, líneas duplicadas, porción de efectivo de la gaveta, neteo de devoluciones en KPIs/desgloses, inmutabilidad histórica, `custom_price`, métodos de pago desconocidos, y orden causal de la cola de sync (bloqueo por producto, `enqueued_at` estable frente a reintentos, FK de producto nuevo, items legados).

## [Unreleased] — Endurecimiento de sincronización offline (2026-07-22)

Correcciones de la auditoría de offline/sync (migración `20260722000000_offline_sync_hardening.sql`). **Migración aplicada y verificada en el proyecto de producción** (`ypbajygoqqgaurikuctd`).

### 🔒 Seguridad
- **Validación de tenant en `process_sale_transaction` y `add_loyalty_points`**: ambos RPC son `SECURITY DEFINER` (saltan RLS) y aceptaban el `business_id` del payload sin verificar — un usuario autenticado podía crear ventas, descontar stock o alterar puntos de OTRO negocio. Ahora rechazan con `42501` como ya hacían los RPC de restaurante.

### 🐛 Bugs corregidos
- **CRÍTICO — Venta en conflicto de stock jamás descontaba inventario al resolverse**: el guard de idempotencia de `process_sale_transaction` cortaba el reintento con `already_processed` antes de descontar. Ahora el reintento de una venta en `stock_conflict` re-verifica stock, lo descuenta y completa la venta de forma atómica (con reclamo por fila para reintentos concurrentes de dos dispositivos).
- **`updated_at` ahora lo mantiene el SERVIDOR en todas las tablas sincronizadas** (trigger `BEFORE INSERT OR UPDATE`): antes las tablas retail no tenían trigger y el cliente subía su propio reloj — un dispositivo con hora atrasada producía cambios que los demás nunca descargaban (el pull incremental filtra por `updated_at > watermark`).
- **Watermark del pull incremental anclado a hora de servidor** (`getServerNow()` en `licenseClock` + clave `nexus_sync_watermark`): antes se usaba `Date.now()` local — un reloj adelantado dejaba cambios remotos "por debajo" del watermark para siempre. Con solapamiento de seguridad de 2 min por ciclo.
- **Paginación estable en `fetchAll`/`fetchSince`** (`order('id')`): sin `ORDER BY`, PostgREST no garantiza orden entre páginas y con >1000 filas podían perderse o duplicarse registros.
- **`close_comanda` ya no puede descontar stock dos veces**: el descuento estaba protegido solo por el `idempotency_key`; un key regenerado (re-cierre) volvía a descontar. Ahora bloquea la fila de la comanda y una comanda `closed` retorna `already_closed` sin tocar inventario.
- **`set_kitchen_status` implementa de verdad el guard anti-escrituras-viejas** que el cliente asumía: nueva columna `kitchen_updated_at` (solo KDS-vs-KDS, sin mezclar el reloj del mesero) — un reintento offline con timestamp viejo ya no pisa un estado de cocina más nuevo.
- **`add_loyalty_points`: reclamo atómico del idempotency key** (INSERT `ON CONFLICT` en vez de SELECT+UPDATE): dos llamadas concurrentes con el mismo key ya no aplican el delta dos veces.
- **`process_sale_transaction` ya no enmascara el SQLSTATE**: se eliminó el `EXCEPTION WHEN OTHERS` que convertía un `23505` (duplicado, idempotencia) en `P0001` genérico.
- **Realtime (KDS): los eventos DELETE ya no corrompen la fila local**: `payload.old` solo trae la PK y al aplicarse con `bulkPut` reemplazaba la comanda completa por un esqueleto `{id}`. Ahora solo se aplican INSERT/UPDATE (`payload.new`).
- **`isTransientError` reconoce 502/429/408** (y "bad gateway"/"too many requests"): una caída temporal del servidor ya no manda ventas válidas a `failed` tras 5 reintentos.
- **Indicador "Conexión a Internet" de Ajustes reactivo**: escucha `online`/`offline` en vivo (antes se evaluaba una sola vez por render).

### 🗄️ Infraestructura
- **Consolidación de migraciones**: `processed_mutations` y los RPC críticos de idempotencia ahora también viven en `supabase/migrations/` (antes solo en `db-migrations/` como scripts manuales sueltos).

### ✅ Verificación en producción (base real `ypbajygoqqgaurikuctd`)
Migración aplicada con `apply_migration` (queda registrada en el historial de migraciones) y comprobada end-to-end simulando un usuario autenticado real (vía claim JWT), con datos de prueba creados y eliminados sin dejar rastro:
- **`updated_at` server-side**: confirmadas las 18 tablas sincronizadas con trigger `BEFORE INSERT OR UPDATE`.
- **Aislamiento multi-tenant**: una venta con `business_id` ajeno se rechaza con `42501`; con el propio pasa el guard. Mismo comportamiento verificado en `add_loyalty_points`.
- **Resolución de `stock_conflict`**: venta que pide 2 con stock 1 → conflicto (stock intacto); tras reponer a 5, el reintento descuenta y completa (stock 3); el tercer reintento es idempotente (sin doble descuento).
- **Guard del KDS (`set_kitchen_status`)**: una escritura de cocina con timestamp anterior se descarta (no pisa el estado más nuevo); una posterior sí aplica.
- **Idempotencia de `add_loyalty_points`**: el mismo `idempotency_key` no vuelve a sumar el delta; un key nuevo sí aplica.

## [Unreleased] — Endurecimiento post-v1.4.0

### 🔒 Seguridad
- **Android `allowBackup=false`** + nueva `data_extraction_rules.xml`: bloquea exfiltración de IndexedDB vía `adb backup` o transferencia D2D.
- **Electron — Navegación segura**: `setWindowOpenHandler` abre URLs externas en el navegador del SO (no BrowserWindow Electron). `will-navigate` bloquea navegación fuera de la app. `will-attach-webview` bloquea webviews embebidos. Menú nativo deshabilitado en producción. DevTools se cierran automáticamente si se abren.
- **PIN reescrito a PBKDF2** (100k iteraciones, salt único por PIN). Compatibilidad legacy SHA-256 con auto-migración silenciosa. Comparación constant-time.
- **Eliminado `VITE_PIN_PEPPER` y `VITE_TECH_PASSWORD`** del bundle (estaban expuestos).
- **`TechGuard.tsx` eliminado** (código muerto que exponía password en el bundle).
- **Rate limit en login** (5 intentos / 15 min) y **rate limit en registro** (3 / 30 min).
- **`requireSuperAdmin` en vivo** antes de cada operación destructiva del Super Panel.
- **Multi-tenant guard**: si `localStorage.nexus_business_id` cambia, se limpia toda la IndexedDB local para evitar mezcla de datos entre negocios.
- **`.env.test` y `.env.local` sacados del tracking de git** (estaban en historial público).
- **Idempotency keys** en `LOYALTY_CHANGE` (UUID por mutación) — previene puntos duplicados en reintentos por red flaky.
- **Defensa en profundidad**: `VOID_SALE` y `PARTIAL_REFUND` ahora filtran por `business_id` además de RLS.

### 🐛 Bugs corregidos
- **Doble reembolso al anular venta con devolución parcial previa**: si una venta tenía partial refund y luego se anulaba completa, devolvía stock y dinero dos veces. Lógica extraída a `lib/saleRefund.ts` (testeable).
- **Puntos canjeados nunca se reversaban en devolución parcial**: ahora cuando un partial cubre toda la venta, se devuelven al cliente.
- **Cuadre histórico mutaba retroactivamente**: anular una venta de un turno cerrado cambiaba el reporte de ese turno. Ahora cada venta anulada lleva `voided_at` (timestamp). Los reportes históricos consideran la venta válida si fue anulada DESPUÉS del cierre del periodo. Nueva función pura `isSaleValidAtTime` en `lib/shiftStats.ts` con 19 tests. Schema Dexie v12 + SQL migration + trigger server-side.

### ⚡ Performance
- **Índice compuesto `[business_id+status]`** en sales (schema v11) — conteo de stock_conflict y filtros por estado sin full scan.
- **Queries Dexie con índices**: `[business_id+date]` y `[shift_id+business_id]` en FinancePage (antes hacían `where + filter` en JS).
- **`manualChunks`** en vite.config: recharts/supabase/dexie/icons en chunks separados → mejor first paint en redes lentas.
- **FinancePage** limita 5000 ventas máximo cargadas a memoria (safety net Android low-end).
- **`autoResolveStockConflicts`**: `Promise.all` para precargar productos (N+1 → 1 round trip).
- **`pruneOldQueueItems`**: borra items `failed` >30 días automáticamente.

### ✨ Features
- **Tests automáticos con Vitest**: 110 tests passing cubriendo `currency`, `pin`, `loginRateLimit`, `syncResolution`, `saleRefund`.
- **GitHub Actions CI**: tsc + tests + build en cada push/PR.
- **Import de productos desde Excel (.xlsx)** vía SheetJS con dynamic import.
- **Recordatorios de vencimiento** en POS (banner + badge en cards) y dashboard de Finanzas.
- **Devolución total** con botón "Todo" en modal de refund (UI cambia color y mensaje cuando es full).
- **Banner suscripción in-app** cuando vencimiento ≤7 días.
- **Sección "Por reponer"** en dashboard de Finanzas (stock bajo).
- **Contador de billetes/monedas** accesible desde sidebar + integrado en cierre de turno.
- **Panel de métricas de sync** en Configuración → Datos: pendientes, fallidos, última sync, desglose por tipo.
- **Banner offline** con desglose detallado por tipo de operación pendiente.
- **Export CSV** en Ventas, Inventario y Clientes (helper común `lib/csv.ts`).
- **Android: back button hardware** maneja modales, navegación y doble-tap para salir.
- **Lifecycle Android**: al volver del background dispara `processQueue` + `syncLiveData`.

### 📚 Documentación
- Nuevo `LICENSE` (licencia comercial propietaria).
- Nuevo `CHANGELOG.md`.
- `.env.test.example` con plantilla sin credenciales.
- `db-migrations/` con SQL para idempotency.

---

## [1.4.0] — 2026-05-13

### Features
- Bump de versión.
- Métricas detalladas de sincronización en Configuración.
- Export CSV reutilizable.
- Tests de `currency.ts`.

### Mantenimiento
- Limpieza de archivos temporales de debug (`tmp_*.json`, `GEMINI_CONTEXT.md`).
- `.gitignore` actualizado con patrones de archivos temporales.
- Pruning automático de `action_queue` items `failed` >30 días.

---

## [1.3.0] — 2026-03-XX

### Features
- **Self-service registration** con período de prueba automático de 7 días.
- **Super Panel — pestaña Suscripciones** con alertas de vencimiento y extensión rápida (+1m / +3m / +12m).
- **AuthGuard** bloquea tanto trial como suscripciones activas vencidas. Pantalla unificada con CTA a WhatsApp.
- **Modelo de cobro plana** (suscripción mensual) reemplaza al modelo por % de ventas anterior.
- **Banner de actualización disponible** en Layout.
- **Sesión persistente offline**: el token expirado sin internet ya no cierra la sesión.
- **Pull incremental** con `updated_at` tracking — sync más eficiente.

### Bugs corregidos
- 6 bugs pre-v1.3.0: trial expiry sin fecha, parked orders con descuento, audit crash, currency precision, backup validation, último admin desactivable.
- 3 bugs pre-release: stock check dentro de transacción, loyalty filter, threshold sync.
- SKU vacío → `null` en origen para no violar UNIQUE en Supabase.
- PRODUCT_SYNC stripping de campos legacy.

---

## [1.2.0] — 2025-XX-XX

### Features
- **Transferencia bidireccional almacén ↔ vitrina** en Inventario.
- **Sistema de actualizaciones seguras** sin pérdida de datos (backup pre-migración automático).
- **Robustez offline y multi-dispositivo**: 6 mejoras al motor de sync (timestamp persistente de backoff, recursión sin deadlock, etc.).

### Bugs corregidos
- Sync multi-dispositivo: `SELECT *` completo para no perder columnas nuevas.
- Limpieza de huérfanos al hacer pull completo.

---

## [1.1.0] — 2025-XX-XX

### Features
- **Reportes por rango de fechas** con filtros y presets (7d / 15d / 30d).
- **Backup automático cada 15 minutos** (8 backups rolling = 2h de protección).
- **Devoluciones parciales** con selección de items, PIN maestro y reembolso a caja.
- **Stock almacén + stock vitrina** separados con transferencias.
- **Importación CSV** de productos con preview y manejo de duplicados.
- **Hardening de seguridad**: protección contra brute-force, CSP en Electron, PIN setup obligatorio para empleados.

### Bugs corregidos
- 9 fixes críticos de seguridad e integridad: validaciones de retiros, cierres, eliminaciones.
- Code splitting + paginación + bulkAdd + memoización para mejor performance.
- 10+ bug fixes en sync multi-dispositivo.

---

## [1.0.0] — 2025-XX-XX

### Lanzamiento inicial
- **POS offline-first** con React 19 + Vite + Tailwind + Dexie (IndexedDB) + Supabase (PostgreSQL + Auth + RLS).
- **Multi-tenant**: aislamiento por `business_id` con RLS en servidor.
- **Roles**: admin (acceso completo) y vendedor (POS + Clientes).
- **Métodos de pago**: efectivo, transferencia, mixto.
- **Puntos de lealtad**: 1 pt por $1 de compra, canje 10 pts = $1.
- **Turnos de caja**: apertura + cierre con cuadre (efectivo + transferencia).
- **Anulación de ventas** con PIN maestro.
- **Auditoría** de todas las operaciones sensibles.
- **Capacitor para Android** y **Electron para Windows**.

---

## Notas

- Hasta el commit `7e8f389` no se mantenía changelog formal. Las entradas anteriores se han reconstruido aproximadamente desde los mensajes de commit y agrupado en releases significativos.
- Las versiones `1.0.0` a `1.2.0` no tienen fecha exacta en los tags de git; reflejan los hitos funcionales mayores.
- A partir de la sección **[Unreleased]**, las próximas releases tendrán entrada en este changelog antes del bump de versión.
