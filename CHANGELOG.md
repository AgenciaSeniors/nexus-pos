# Changelog

Todos los cambios notables de **Bisne con Talla / Nexus POS** se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el versionado
sigue [Semantic Versioning](https://semver.org/lang/es/).

---

## [Unreleased] — Recuperación de contraseña: errores claros y diagnóstico (2026-08-25)

### 🐛 Bugs corregidos
- **"Enviar código" fallaba sin decir por qué**: el toast mostraba el mensaje crudo de Supabase (en inglés) o uno genérico. Ahora los fallos de `resetPasswordForEmail` se traducen: sin internet, límite de 1 correo cada 60 s (429), fallo del servidor de correo/SMTP (500) y correo con formato inválido. El error real queda en consola con el prefijo `[reset-password]` para verlo por `adb logcat`.
- **Reintentos que provocaban el propio error**: al pulsar "Reenviar código" enseguida, Supabase respondía 429 y parecía que el sistema estaba roto. Tras un envío correcto, el botón queda bloqueado 60 s con cuenta atrás visible (también el de "Enviar código").
- **Sesión abierta si fallaba el cambio de contraseña**: si `verifyOtp` acertaba pero `updateUser` fallaba, la sesión de recuperación quedaba viva y la app podía entrar sola con la contraseña vieja mostrando "Código inválido". Ahora se cierra sesión en el fallo y el mensaje distingue código inválido de contraseña rechazada.
- **Validación del correo antes de llamar al servidor**: evita gastar el límite de envíos con direcciones mal escritas.
- **`Failed to fetch` ya no se atribuye a la conexión del usuario**: ese error también aparece cuando el servidor no responde (proyecto de Supabase en pausa) o cuando un `500` del envío SMTP llega sin cabeceras CORS. Ahora el mensaje distingue según `navigator.onLine`: sin conexión culpa a internet; en línea dice que no se pudo contactar con el servidor y ofrece WhatsApp.

### 📄 Documentación
- **`docs/correo-recuperacion-contrasena.md`**: causas reales de que el código no llegue — la principal es que el proyecto siga usando el correo integrado de Supabase, que **solo entrega a las direcciones del equipo** y con tope de 2 correos/hora; se requiere SMTP propio con dominio verificado. Incluye además la plantilla con `{{ .Token }}`, los rate limits y cómo comprobarlo en los Auth Logs.

> ⚠️ El envío del correo lo hace el servidor de Supabase, no la app: si no hay SMTP propio configurado, ningún cambio en el cliente hará que el código llegue a los clientes.

---

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
