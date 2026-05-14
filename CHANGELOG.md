# Changelog

Todos los cambios notables de **Bisne con Talla / Nexus POS** se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el versionado
sigue [Semantic Versioning](https://semver.org/lang/es/).

---

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
