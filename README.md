# 🚀 NEXUS POS

> **Sistema de Punto de Venta (POS) Offline-First con Arquitectura SaaS Multi-Tenant.**

---

## 📋 Descripción del Proyecto

**Nexus POS** es una Plataforma Web Progresiva (PWA) diseñada para resolver la problemática de negocios en zonas con conectividad inestable. A diferencia de los POS tradicionales, Nexus prioriza la **autonomía local**: permite vender, gestionar inventario y controlar finanzas sin internet, sincronizando los datos automáticamente con la nube cuando la conexión regresa.

El sistema opera bajo un modelo **SaaS (Software as a Service)**, permitiendo que múltiples negocios utilicen la misma infraestructura de forma segura y aislada, con un sistema de licencias integrado para el control de acceso.

---

## 📑 Tabla de Contenidos

1. [Características Principales](https://www.google.com/search?q=%23-caracter%C3%ADsticas-principales)
2. [Arquitectura del Sistema](https://www.google.com/search?q=%23-arquitectura-del-sistema)
3. [Stack Tecnológico](https://www.google.com/search?q=%23-stack-tecnol%C3%B3gico)
4. [Estructura del Proyecto](https://www.google.com/search?q=%23-estructura-del-proyecto)
5. [Diseño de Base de Datos](https://www.google.com/search?q=%23-dise%C3%B1o-de-base-de-datos)
6. [Instalación y Despliegue](https://www.google.com/search?q=%23-instalaci%C3%B3n-y-despliegue)
7. [Roadmap](https://www.google.com/search?q=%23-roadmap)
8. [Autor](https://www.google.com/search?q=%23-autor)

---

## ✨ Características Principales

### 🛒 Punto de Venta (POS)

* **Venta Offline:** Procesa transacciones sin necesidad de internet.
* **Interfaz Ágil:** Diseño optimizado con búsqueda en tiempo real y filtrado por **Categorías**.
* **Ticket Virtual:** Generación de recibos personalizables con datos del negocio.

### 📦 Gestión de Inventario

* **CRUD Completo:** Crear, Leer, Editar y Eliminar productos.
* **Control de Stock:** Actualización automática tras cada venta.
* **Categorización:** Organización de productos (Bebidas, Comida, etc.) para acceso rápido.

### 💰 Finanzas y Reportes

* **Cálculo de Ganancias:** Análisis en tiempo real de `Ventas Totales - Costo de Productos`.
* **Dashboard:** Gráficos y métricas clave (Ingresos hoy, esta semana, histórico).

### 🛡️ Seguridad y Administración

* **Roles de Usuario:**
* `Admin`: Acceso total (Configuración, Finanzas, Inventario).
* `Seller`: Acceso restringido solo al POS.


* **Configuración del Negocio:** Personalización de nombre, dirección y mensajes del ticket.
* **Kill-Switch (Licenciamiento):** Sistema automatizado (`AuthGuard`) que bloquea el acceso si la licencia del negocio está "suspendida".
* **Super Admin:** Panel secreto para dar de alta nuevos negocios y usuarios rápidamente.

---

## 🏗 Arquitectura del Sistema

El proyecto implementa un modelo híbrido avanzado para garantizar la resiliencia de los datos.

### 1. Modelo de Datos (Offline-First)

* **Cloud (Supabase/PostgreSQL):** Fuente de la verdad y backup centralizado.
* **Local (Dexie.js/IndexedDB):** Base de datos operativa en el navegador. Garantiza latencia cero.

### 2. Sincronización Bidireccional

El sistema utiliza un algoritmo de colas personalizado en `src/lib/sync.ts`:

* **Pull (Descarga):** Al detectar conexión o iniciar sesión, descarga productos y configuraciones actualizadas.
* **Push (Subida):** Las ventas, ediciones y nuevos productos se guardan en una cola local (`pending_create`, `pending_update`) y se suben en background.

### 3. Seguridad Multi-Tenant (RLS)

Utilizamos **Row Level Security** de PostgreSQL. Cada consulta SQL se filtra automáticamente por `business_id`, asegurando que un negocio nunca vea los datos de otro.

---

## 🛠 Stack Tecnológico

| Capa | Tecnología | Propósito |
| --- | --- | --- |
| **Frontend** | React 18 + Vite | SPA de alto rendimiento. |
| **Lenguaje** | TypeScript | Tipado estático para evitar errores en tiempo de ejecución. |
| **Estilos** | Tailwind CSS | Diseño moderno, limpio y **Responsive** (Móvil/PC). |
| **DB Local** | Dexie.js | Abstracción de IndexedDB. |
| **Backend** | Supabase | Auth, Database y Storage. |
| **Iconos** | Lucide React | Iconografía moderna. |

---

## 📂 Estructura del Proyecto

```bash
src/
├── components/       
│   ├── AuthGuard.tsx     # 🛡️ Protege la app validando la licencia del negocio
│   ├── Layout.tsx        # Navegación Responsive (Sidebar en PC / BottomBar en Móvil)
│   └── TicketModal.tsx   # Visualización del recibo de venta
├── lib/              
│   ├── db.ts             # Esquema de base de datos Local (Dexie)
│   ├── supabase.ts       # Cliente de conexión
│   └── sync.ts           # 🔄 Motor de sincronización
├── pages/            
│   ├── PosPage.tsx       # Punto de Venta (Grid de productos + Carrito)
│   ├── InventoryPage.tsx # CRUD de Productos
│   ├── FinancePage.tsx   # Dashboard de Ganancias
│   ├── SettingsPage.tsx  # Configuración del Negocio
│   ├── SuperAdminPage.tsx # Panel secreto para crear clientes
│   └── LoginPage.tsx     
├── App.tsx               # Rutas y Protección
└── index.css             # Estilos globales y Tailwind

```

---

## 💾 Diseño de Base de Datos (Supabase)

Esquema SQL necesario para el funcionamiento del SaaS.

<details>
<summary><strong>👇 Ver Script SQL Completo</strong></summary>

```sql
-- 1. NEGOCIOS (Tenants)
CREATE TABLE businesses (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active', -- 'active' | 'suspended'
    address TEXT,
    phone TEXT,
    receipt_message TEXT DEFAULT '¡Gracias por su compra!',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. USUARIOS (Perfiles con Roles)
CREATE TABLE profiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    business_id UUID REFERENCES businesses(id) NOT NULL,
    role TEXT DEFAULT 'seller', -- 'admin' | 'seller'
    full_name TEXT
);

-- 3. PRODUCTOS
CREATE TABLE products (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    business_id UUID REFERENCES businesses(id) NOT NULL,
    name TEXT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    cost DECIMAL(10,2) DEFAULT 0, -- Para calcular ganancia
    stock INTEGER DEFAULT 0,
    sku TEXT,
    category TEXT DEFAULT 'General',
    UNIQUE(business_id, sku)
);

-- 4. VENTAS
CREATE TABLE sales (
    id UUID PRIMARY KEY,
    business_id UUID REFERENCES businesses(id) NOT NULL,
    date TIMESTAMPTZ NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    items JSONB NOT NULL, -- Guardamos los items vendidos como JSON
    created_at TIMESTAMPTZ DEFAULT now()
);

```

</details>

---

## 🚀 Instalación y Despliegue

### Localmente

1. Clonar repositorio: `git clone <url>`
2. Instalar: `npm install`
3. Configurar `.env.local`:
```env
VITE_SUPABASE_URL=tu_url
VITE_SUPABASE_ANON_KEY=tu_key

```


4. Correr: `npm run dev`

### Producción (Vercel)

El proyecto está optimizado para **Vercel**.

1. Importar repositorio en Vercel.
2. Agregar las variables de entorno.
3. Deploy.

---

## ✅ Roadmap

### Fase 1: Core (Completado) ✅

* [x] Autenticación y Base de Datos Local.
* [x] Sincronización Offline/Online.
* [x] CRUD de Inventario con Categorías.
* [x] POS con Carrito y Tickets.

### Fase 2: Negocio & SaaS (Completado) ✅

* [x] Reportes Financieros (Ganancia Real).
* [x] Configuración de Negocio (Logo/Texto Ticket).
* [x] Roles (Admin vs Seller).
* [x] Sistema de Licencias (Bloqueo por falta de pago).
* [x] Panel Super Admin.

### Fase 3: Futuro (Ideas) 🔮

* [ ] Integración con impresoras térmicas Bluetooth.
* [ ] Escaneo de código de barras con cámara.
* [ ] Facturación electrónica.

---

## 👤 Autor

**Eduardo Daniel Pérez Ruiz**

* 🎓 Estudiante de Ciencias de la Computación
* 📍 Sancti Spíritus, Cuba
* 💼 Agencia "Señores"