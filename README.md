# 🚀 Bisne con Talla / Nexus POS

> **Sistema de Punto de Venta (POS) Offline-First con arquitectura SaaS multi-tenant.**
> Diseñado para negocios cubanos con conectividad inestable.

[![CI](https://github.com/AgenciaSeniors/nexus-pos/actions/workflows/ci.yml/badge.svg)](https://github.com/AgenciaSeniors/nexus-pos/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-110%20passing-brightgreen)]()
[![Versión](https://img.shields.io/badge/versi%C3%B3n-1.4.0-blue)]()
[![Licencia](https://img.shields.io/badge/licencia-Propietaria-red)](./LICENSE)

---

## 📋 Descripción

**Bisne con Talla** (también conocido como *Nexus POS*) es una aplicación de punto de venta diseñada específicamente para negocios cubanos donde la conexión a internet es intermitente. A diferencia de los POS tradicionales, esta app prioriza la **autonomía local**: permite vender, gestionar inventario y controlar finanzas sin internet, sincronizando con la nube cuando la conexión regresa.

El sistema opera en **3 plataformas**:
- 🌐 **Web/PWA** (cualquier navegador moderno)
- 📱 **Android** (vía Capacitor)
- 🖥️ **Windows** (vía Electron, instalador NSIS)

---

## 📑 Tabla de contenidos

1. [Características principales](#-características-principales)
2. [Stack tecnológico](#-stack-tecnológico)
3. [Arquitectura](#-arquitectura)
4. [Setup inicial](#-setup-inicial-30-min)
5. [Scripts disponibles](#-scripts-disponibles)
6. [Build de producción](#-build-de-producción)
7. [Tests](#-tests)
8. [Estructura del proyecto](#-estructura-del-proyecto)
9. [Migraciones de base de datos](#-migraciones-de-base-de-datos)
10. [Documentos relacionados](#-documentos-relacionados)
11. [Autor](#-autor)

---

## ✨ Características principales

### 🛒 Punto de venta
- Búsqueda en tiempo real por nombre o SKU
- Filtrado por categorías
- Pago efectivo, transferencia, **mixto** (split)
- Descuentos por % o monto fijo
- Puntos de lealtad (1 pt por $1; canje 10 pts = $1)
- Tickets imprimibles (térmicas vía Electron / Android print API)
- Cuentas en espera (parked orders)
- **Vencimientos de productos** (banner + badge en cards)

### 📦 Inventario
- Stock **vitrina** + stock **almacén** con transferencias
- Umbrales de stock bajo configurables por producto
- Fechas de vencimiento con alertas
- Import desde **CSV** y **Excel (.xlsx)**
- Export a CSV
- Historial de movimientos con razones

### 💰 Finanzas
- Turnos de caja con apertura + cierre + cuadre (efectivo + transferencia)
- **Contador de billetes/monedas** integrado en el cierre
- Reportes por día y por rango con gráficos
- Devoluciones **parciales** y **totales** (con reversión proporcional de puntos)
- Anulación de ventas con PIN maestro
- Export CSV de ventas
- Sección "Por reponer" y "Próximos a vencer" en dashboard

### 👥 Clientes
- Fidelización con puntos de lealtad
- Historial completo de compras
- Export CSV
- Sincronización multi-dispositivo de puntos vía RPC atómico

### 🛡️ Seguridad y administración
- **Multi-tenant** con aislamiento por `business_id` (RLS en Supabase)
- **Roles**: admin (acceso completo) y vendedor (POS + Clientes)
- **PIN PBKDF2** (100k iteraciones) con auto-migración desde formato legacy
- **Rate limit** en login (5 intentos / 15 min) y registro (3 / 30 min)
- **Auditoría** de todas las operaciones sensibles
- **Auto-backup local** cada 15 minutos
- **Super Panel** para gestión de suscripciones con extensión rápida

### 🔄 Sincronización
- Cola persistente con backoff exponencial (30s → 60s → 2m → 4m → 5m)
- Idempotency keys en operaciones críticas (puntos de lealtad)
- Auto-resolución de conflictos de stock cuando se repone
- Detección de tombstones (orphan cleanup) cada 24h
- Reintentos automáticos tras `TOKEN_REFRESHED`

---

## 🛠 Stack tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| Frontend | React + Vite | 19.x / 7.x |
| Lenguaje | TypeScript | 5.9 (strict) |
| Estilos | Tailwind CSS | 3.4 |
| DB local | Dexie.js (IndexedDB) | 4.x |
| Backend | Supabase (Postgres + Auth + RLS) | — |
| Mobile | Capacitor | 8.x |
| Desktop | Electron + electron-builder | 39.x / 26.x |
| Routing | React Router | 7.x (HashRouter) |
| Charts | Recharts | — |
| Notificaciones | Sonner | — |
| Iconos | Lucide React | — |
| Tests | Vitest | 4.1 |
| Excel | xlsx (SheetJS) | 0.18 |

---

## 🏗 Arquitectura

### Offline-first híbrido
- **Cloud (Supabase / PostgreSQL)**: fuente de verdad + backup centralizado. RLS estricto por tenant.
- **Local (Dexie / IndexedDB)**: BD operativa con todas las tablas. Latencia cero.
- **Sync engine** (`src/lib/sync.ts`):
  - **Pull incremental** con `updated_at > since` (eficiente, no descarga todo cada 30s)
  - **Push queue** con backoff exponencial y persistencia
  - **Orphan cleanup** cada 24h para detectar borrados físicos
  - **Resolución de conflictos** por `updated_at` (función pura testeable en `lib/syncResolution.ts`)

### Seguridad multi-tenant
- **RLS server-side** (capa principal)
- **Defensa en profundidad** client-side: queries filtran por `business_id` además de RLS
- **Tenant guard**: si `localStorage.nexus_business_id` cambia, se limpia toda la IndexedDB local

---

## 🚀 Setup inicial (30 min)

### Requisitos
- Node.js **20+** (el CI corre en 20)
- npm 10+ (o pnpm/yarn equivalente)
- Para Android: Android Studio + JDK 17
- Para Windows: cualquier Windows (Electron builder usa el host)

### Pasos

```bash
# 1. Clonar
git clone https://github.com/AgenciaSeniors/nexus-pos.git
cd nexus-pos

# 2. Instalar
npm install

# 3. Configurar variables de entorno
cp .env.example .env.local
# Edita .env.local con tu URL y anon key de Supabase

# 4. (Opcional) Configurar tests E2E
cp .env.test.example .env.test.local
# Edita .env.test.local con credenciales de prueba

# 5. Iniciar dev server
npm run dev
# Abre http://localhost:5173
```

### Supabase setup

1. Crear proyecto en https://supabase.com
2. Ejecutar el esquema base (ver `db-migrations/` o pedir al autor el dump inicial)
3. Aplicar migraciones recientes en `db-migrations/` (en orden cronológico por nombre)
4. Copiar `URL` y `anon key` a `.env.local`

---

## 📜 Scripts disponibles

```bash
npm run dev                # Vite dev server :5173
npm run build              # tsc + Vite build production
npm run preview            # Previsualizar build de producción
npm test                   # Vitest run (tests unitarios)
npm run test:watch         # Vitest en modo watch

# Electron (desktop)
npm run electron:dev       # Concurrently: vite + electron en dev
npm run electron:build     # Build + electron-builder → release/

# Versionado
npm run version:patch      # Bump 1.4.0 → 1.4.1
npm run version:minor      # Bump 1.4.0 → 1.5.0
```

---

## 🏭 Build de producción

### 🌐 Web / PWA

```bash
npm run build
# Output: dist/
# Sube dist/ a Vercel, Netlify, Cloudflare Pages, etc.
```

El proyecto está configurado con `base: './'` para que funcione en cualquier hosting estático (incluido subdirectorios).

### 🖥️ Windows (NSIS installer)

```bash
npm run electron:build
# Output: release/Bisne con Talla Setup X.Y.Z.exe
```

El instalador `.exe` se firma automáticamente si tienes certificado configurado en electron-builder.

### 📱 Android (APK / AAB)

```bash
# 1. Build web
npm run build

# 2. Sync con Capacitor
npx cap sync android

# 3a. Build debug APK
cd android
./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk

# 3b. Build release APK (firmado)
./gradlew assembleRelease
# Output: android/app/build/outputs/apk/release/app-release.apk

# 3c. Build AAB para Play Store
./gradlew bundleRelease
```

Para el signing en producción, configura `android/local.properties`:
```properties
storeFile=path/to/keystore.jks
storePassword=tu-password
keyAlias=tu-alias
keyPassword=tu-password
```

---

## 🧪 Tests

```bash
npm test                # Corre tests una vez (110 tests)
npm run test:watch      # Watch mode
```

**Cobertura actual** (`src/lib/`):
- `currency.test.ts` — 31 tests (matemática segura de decimales)
- `pin.test.ts` — 17 tests (PBKDF2 + legacy SHA-256)
- `loginRateLimit.test.ts` — 12 tests (bloqueo por intentos)
- `syncResolution.test.ts` — 32 tests (lógica crítica del sync)
- `saleRefund.test.ts` — 18 tests (cálculo de reembolsos / void)

**E2E con Playwright** (`tests/`): pendiente expandir cobertura.

---

## 📂 Estructura del proyecto

```
src/
├── App.tsx                       # Rutas + auth flow + onAuthStateChange
├── index.css                     # Tailwind + estilos globales
│
├── components/
│   ├── AuthGuard.tsx             # 🛡️ Valida sesión + suscripción + tenant
│   ├── Layout.tsx                # Navegación responsive + banners
│   ├── BillCounter.tsx           # Contador de billetes/monedas CUP
│   ├── TicketModal.tsx           # Ticket imprimible
│   ├── CustomersPage.tsx         # CRUD clientes + fidelización
│   ├── CustomerSelect.tsx        # Selector inline en POS
│   ├── ParkedOrdersModal.tsx     # Órdenes en espera
│   ├── InventoryHistory.tsx      # Movimientos de inventario
│   ├── StaffSelectorModal.tsx    # Login de vendedor con PIN
│   └── ...
│
├── pages/
│   ├── PosPage.tsx               # Punto de venta + carrito
│   ├── InventoryPage.tsx         # CRUD productos + import CSV/Excel
│   ├── FinancePage.tsx           # Dashboard + turnos + reportes
│   ├── SettingsPage.tsx          # Config negocio + equipo + datos
│   ├── SuperAdminPage.tsx        # Panel admin global (/super-panel)
│   └── SuperAdminLogin.tsx       # Login del super admin
│
├── lib/
│   ├── db.ts                     # Schema Dexie (v11) + tipos
│   ├── supabase.ts               # Cliente Supabase
│   ├── sync.ts                   # Motor de sincronización (849 LOC)
│   ├── syncResolution.ts         # Funciones puras testeables del sync
│   ├── saleRefund.ts             # Cálculo de reembolsos / void (puro)
│   ├── currency.ts               # Matemática decimal segura
│   ├── pin.ts                    # PBKDF2 + verificación constant-time
│   ├── loginRateLimit.ts         # Rate limit por email
│   ├── requireSuperAdmin.ts      # Verificación en vivo de permisos admin
│   ├── audit.ts                  # Log de operaciones sensibles
│   ├── backup.ts                 # Backup automático local (15 min)
│   ├── csv.ts                    # Export CSV helper
│   ├── version.ts                # Check de versión disponible
│   ├── config.ts                 # Constantes (WhatsApp admin, etc.)
│   └── androidBackHandler.ts     # Back button hardware + lifecycle
│
├── assets/
│   └── logo.png
│
└── vite-env.d.ts

android/                          # Capacitor (Android)
electron/                         # Electron (Windows)
db-migrations/                    # SQL migrations para Supabase
.github/workflows/                # CI: tsc + tests + build
public/                           # Assets estáticos PWA
```

---

## 💾 Migraciones de base de datos

Las migraciones SQL para Supabase están en `db-migrations/` y `supabase/migrations/`.

**Orden de aplicación** (en Supabase SQL Editor):
1. Schema inicial (consultar con el autor — no versionado por motivos históricos)
2. `supabase/migrations/20260323000000_security_hardening.sql`
3. `db-migrations/2026-05-13-idempotency.sql`

Cada migración es **idempotente** (`IF NOT EXISTS`, `OR REPLACE`) — segura de re-ejecutar.

---

## 📚 Documentos relacionados

- [`CHANGELOG.md`](./CHANGELOG.md) — Historial detallado de releases
- [`LICENSE`](./LICENSE) — Términos de licencia comercial
- [`.env.example`](./.env.example) — Plantilla de variables de entorno
- [`db-migrations/`](./db-migrations/) — SQL migrations para Supabase

---

## 👤 Autor

**Eduardo Daniel Pérez Ruiz**
- 🎓 Estudiante de Ciencias de la Computación
- 📍 Sancti Spíritus, Cuba
- 💼 Agencia *Señores*

Soporte y consultas: ver dentro de la app en **Configuración → Términos y Política**.

---

## 🤝 Contribuciones

Este es un proyecto propietario. Si eres parte del equipo de desarrollo, sigue estas convenciones:

- **Commits**: usa el prefijo de tipo (`feat:`, `fix:`, `security:`, `perf:`, `refactor:`, `docs:`, `test:`)
- **Tests**: agrega tests para lógica crítica nueva (funciones puras en `lib/`)
- **CI**: tu PR debe pasar `tsc`, `npm test` y `npm run build`
- **TypeScript estricto**: evita `any` excepto en payloads de Supabase (con razón documentada)

---

_Versión de este README: actualizado al commit `31fbb60` (Mayo 2026)._
