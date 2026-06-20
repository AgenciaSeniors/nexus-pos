/**
 * Página de previsualización SOLO para revisión de diseño (no entra al build de
 * producción; se sirve vía /preview.html en dev). Renderiza el kit premium y
 * composiciones de las pantallas del modo restaurante con datos de ejemplo, para
 * poder capturar screenshots sin Supabase ni login.
 */
import { useState, type ReactNode } from 'react';
import {
  UtensilsCrossed, Clock, CircleDollarSign, Armchair, ChefHat, Flame, Check, User,
  ClipboardList, Users, ListChecks, CreditCard, Trash2, MapPin, Plus, Search,
} from 'lucide-react';
import {
  Button, Input, Select, Badge, StatCard, SegmentedControl, Stepper, IconButton,
  SectionCard, PageHeader, EmptyState, Card,
} from '../components/ui';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-xs font-black text-[#6B7280] uppercase tracking-widest mb-3">{title}</h2>
      {children}
    </section>
  );
}

/* ---- Datos de ejemplo ---- */
const TABLES = [
  { name: 'Mesa 1', state: 'libre' as const, total: 0, mins: 0 },
  { name: 'Mesa 2', state: 'ocupada' as const, total: 34.5, mins: 12 },
  { name: 'Mesa 3', state: 'por_cobrar' as const, total: 78.0, mins: 47 },
  { name: 'Terraza 1', state: 'libre' as const, total: 0, mins: 0 },
  { name: 'Terraza 2', state: 'ocupada' as const, total: 21.0, mins: 5 },
  { name: 'Barra 1', state: 'reservada' as const, total: 0, mins: 0 },
];
const STATE_STYLES = {
  libre: { box: 'border-[#7AC142]/30 bg-[#7AC142]/5', dot: 'bg-[#7AC142] shadow-[0_0_6px_#7AC142]', label: 'Libre' },
  ocupada: { box: 'border-amber-300 bg-amber-50', dot: 'bg-amber-500 shadow-[0_0_6px_#f59e0b]', label: 'Ocupada' },
  por_cobrar: { box: 'border-red-300 bg-red-50', dot: 'bg-red-500 shadow-[0_0_6px_#ef4444]', label: 'Por cobrar' },
  reservada: { box: 'border-blue-300 bg-blue-50', dot: 'bg-blue-500 shadow-[0_0_6px_#3b82f6]', label: 'Reservada' },
};

const KDS_TICKETS = [
  { mesa: 'Mesa 5', mins: 3, head: 'from-[#0B3B68] to-[#092b4d]', chip: 'bg-white/20 text-white', ring: 'border-gray-200', items: [{ q: 2, n: 'Mojito', mods: 'sin azúcar' }, { q: 1, n: 'Tostones' }] },
  { mesa: 'Mesa 2', mins: 7, head: 'from-amber-500 to-amber-600', chip: 'bg-amber-400 text-amber-950', ring: 'border-amber-300', items: [{ q: 1, n: 'Ropa vieja', mods: 'término medio' }, { q: 3, n: 'Arroz blanco' }] },
  { mesa: 'Mesa 3', mins: 14, head: 'from-red-600 to-red-700', chip: 'bg-red-500 text-white', ring: 'border-red-400 shadow-[0_0_0_1px_#f87171]', items: [{ q: 2, n: 'Pizza Napolitana', mods: 'extra queso' }] },
];

const COMANDA_ITEMS = [
  { name: 'Mojito', mods: 'sin azúcar', qty: 2, total: 7.0 },
  { name: 'Ropa vieja', mods: 'término medio', qty: 1, total: 12.0 },
  { name: 'Tostones', qty: 1, total: 4.5 },
];

export default function DesignPreview() {
  const [split, setSplit] = useState<'equal' | 'item'>('equal');
  const [parts, setParts] = useState(3);
  const comTotal = COMANDA_ITEMS.reduce((s, i) => s + i.total, 0);

  return (
    <div className="min-h-screen bg-[#F3F4F6] p-5 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-black text-[#0B3B68]">nexus · Modo Restaurante</h1>
          <p className="text-[#6B7280]">Previsualización del pase de diseño premium (datos de ejemplo)</p>
        </div>

        {/* KIT */}
        <Block title="Botones">
          <div className="flex flex-wrap gap-3 items-center">
            <Button>Primario</Button>
            <Button variant="navy">Navy</Button>
            <Button variant="secondary">Secundario</Button>
            <Button variant="danger">Eliminar</Button>
            <Button variant="ghost" icon={<Plus size={18} />}>Ghost</Button>
            <Button loading>Cargando</Button>
            <IconButton label="Buscar" icon={<Search size={18} />} />
            <IconButton label="Cocina" variant="navy" icon={<ChefHat size={18} />} />
          </div>
        </Block>

        <Block title="Campos y controles">
          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
            <Input label="Nombre del plato" placeholder="Ej. Ropa vieja" />
            <Input label="Precio" icon={<span className="font-bold">$</span>} placeholder="0.00" />
            <Select label="Área"><option>Salón</option><option>Terraza</option></Select>
            <Input label="Con error" error="Este campo es obligatorio" placeholder="—" />
          </div>
          <div className="flex flex-wrap items-center gap-4 mt-4">
            <SegmentedControl value={split} onChange={setSplit}
              options={[{ value: 'equal', label: 'Partes iguales', icon: <Users size={16} /> }, { value: 'item', label: 'Por ítem', icon: <ListChecks size={16} /> }]} />
            <Stepper value={parts} min={1} max={10} onDecrement={() => setParts(p => Math.max(1, p - 1))} onIncrement={() => setParts(p => Math.min(10, p + 1))} />
            <Badge color="green" icon={<Check size={13} />}>Activo</Badge>
            <Badge color="amber" icon={<Clock size={13} />}>Pendiente</Badge>
            <Badge color="red">Agotado</Badge>
          </div>
        </Block>

        {/* MESAS */}
        <Block title="Pantalla · Mesas">
          <PageHeader title="Mesas" icon={<UtensilsCrossed className="text-[#0B3B68]" />} className="mb-4"
            action={<Button variant="ghost" size="sm" icon={<Plus size={16} />}>Áreas y mesas</Button>} />
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard label="Libres" value={3} icon={<Armchair size={16} />} />
            <StatCard label="Ocupadas" value={2} icon={<Clock size={16} />} />
            <StatCard tone="green" label="En curso" value="$133.50" icon={<CircleDollarSign size={16} />} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {TABLES.map(t => {
              const s = STATE_STYLES[t.state];
              return (
                <div key={t.name} className={`relative p-4 rounded-2xl border-2 text-left shadow-card ${s.box}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-black text-[#1F2937] text-lg truncate">{t.name}</span>
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
                  </div>
                  <p className="text-[11px] font-bold text-[#6B7280] uppercase">{s.label}</p>
                  {t.total > 0 && (
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-sm font-black text-[#0B3B68]">${t.total.toFixed(2)}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#6B7280]"><Clock size={11} /> {t.mins}m</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Block>

        {/* COCINA */}
        <Block title="Pantalla · Cocina (KDS)">
          <PageHeader title="Cocina" icon={<ChefHat className="text-[#0B3B68]" />} className="mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {KDS_TICKETS.map(t => (
              <div key={t.mesa} className={`bg-white rounded-2xl border-2 overflow-hidden shadow-card ${t.ring}`}>
                <div className={`bg-gradient-to-r ${t.head} text-white px-4 py-2.5 flex items-center justify-between`}>
                  <span className="font-black">{t.mesa}</span>
                  <span className={`inline-flex items-center gap-1 text-xs font-black px-2 py-0.5 rounded-full ${t.chip}`}><Clock size={12} /> {t.mins}m</span>
                </div>
                <div className="p-3 space-y-2">
                  {t.items.map((it, i) => (
                    <div key={i} className="p-3 rounded-xl border border-gray-200 bg-gray-50">
                      <p className="font-bold text-[#1F2937]"><span className="text-[#0B3B68]">{it.q}×</span> {it.n}</p>
                      {it.mods && <p className="text-xs text-[#0B3B68] mt-0.5">{it.mods}</p>}
                      <div className="flex gap-2 mt-2.5">
                        <button className="flex-1 bg-amber-500 text-white text-sm font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5"><Flame size={16} /> Preparar</button>
                        <button className="flex-1 bg-grad-green text-white text-sm font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5 shadow-glow-green"><Check size={16} /> Listo</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Block>

        {/* COMANDA + DIVIDIR */}
        <Block title="Pantalla · Comanda y Dividir cuenta">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Panel de comanda */}
            <div className="lg:w-96 shrink-0 bg-white rounded-2xl border border-gray-200 shadow-card p-4 flex flex-col">
              <div className="flex items-center gap-3 mb-3">
                <IconButton label="Volver" icon={<UtensilsCrossed size={18} />} />
                <div>
                  <h3 className="text-lg font-black text-[#1F2937]">Mesa 2</h3>
                  <p className="text-xs text-[#6B7280] flex items-center gap-1"><User size={12} /> Eduardo</p>
                </div>
              </div>
              <div className="space-y-2">
                {COMANDA_ITEMS.map(it => (
                  <div key={it.name} className="flex items-center gap-2 p-2 rounded-xl bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-[#1F2937] truncate">{it.name}</p>
                      {it.mods && <p className="text-[11px] text-[#6B7280] truncate">{it.mods}</p>}
                      <p className="text-xs text-[#6B7280]">${it.total.toFixed(2)}</p>
                    </div>
                    <Stepper size="sm" value={it.qty} onDecrement={() => {}} onIncrement={() => {}} />
                    <IconButton size="sm" variant="danger" label="Quitar" icon={<Trash2 size={14} />} />
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 mt-3 pt-3">
                <div className="flex justify-between items-center mb-3 bg-[#0B3B68]/5 rounded-xl px-3 py-2.5">
                  <span className="font-bold text-[#6B7280] uppercase text-xs tracking-wide">Total</span>
                  <span className="text-2xl font-black text-[#0B3B68]">${comTotal.toFixed(2)}</span>
                </div>
                <Button variant="navy" fullWidth size="lg" className="mb-2" icon={<ChefHat size={20} />}>Enviar a cocina (2)</Button>
                <div className="flex gap-2">
                  <Button variant="secondary" size="lg" className="border-2 border-[#0B3B68] text-[#0B3B68]" icon={<Users size={18} />}>Dividir</Button>
                  <Button variant="primary" size="lg" fullWidth icon={<CreditCard size={20} />}>Cobrar</Button>
                </div>
              </div>
            </div>

            {/* "Modal" Dividir cuenta (panel estático, mismo estilo que el Modal real) */}
            <div className="flex-1 max-w-md">
              <div className="bg-white rounded-3xl shadow-modal overflow-hidden">
                <div className="bg-grad-navy px-5 py-4 text-white flex items-center justify-between">
                  <h2 className="text-lg font-black flex items-center gap-2"><Users size={18} /> Dividir cuenta · $23.50</h2>
                </div>
                <div className="p-4 space-y-4">
                  <SegmentedControl fullWidth value={split} onChange={setSplit}
                    options={[{ value: 'equal', label: 'Partes iguales', icon: <Users size={18} /> }, { value: 'item', label: 'Por ítem', icon: <ListChecks size={18} /> }]} />
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-[#6B7280]">Cuentas</span>
                    <Stepper value={parts} min={2} max={10} onDecrement={() => setParts(p => Math.max(2, p - 1))} onIncrement={() => setParts(p => Math.min(10, p + 1))} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-[#6B7280]">
                      <span className="uppercase tracking-wide">Cuentas</span><span>1 de {parts} pagadas</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-grad-green rounded-full" style={{ width: `${(1 / parts) * 100}%` }} />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-xl border border-[#7AC142]/40 bg-[#7AC142]/5">
                      <div><p className="font-bold text-[#1F2937]">Cuenta 1</p><p className="text-sm text-[#0B3B68] font-black">$7.83</p></div>
                      <span className="flex items-center gap-1 text-[#4f7d24] font-bold text-sm"><Check size={16} /> Pagada</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-xl border border-gray-200">
                      <div><p className="font-bold text-[#1F2937]">Cuenta 2</p><p className="text-sm text-[#0B3B68] font-black">$7.83</p></div>
                      <Button size="sm" icon={<CreditCard size={16} />}>Cobrar</Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Block>

        {/* PANEL CONFIG */}
        <Block title="Panel de configuración">
          <div className="grid md:grid-cols-2 gap-4">
            <SectionCard title="Áreas" icon={<MapPin size={18} className="text-[#0B3B68]" />} subtitle="Zonas de tu local.">
              <div className="flex gap-2 mb-4">
                <Input placeholder="Ej. Salón, Terraza" className="flex-1" />
                <Button icon={<Plus size={18} />}>Añadir</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge color="navy">Salón</Badge>
                <Badge color="navy">Terraza</Badge>
                <Badge color="navy">Barra</Badge>
              </div>
            </SectionCard>
            <SectionCard title="Ingredientes" accent="green" icon={<Plus size={18} className="text-[#5a9d2e]" />}
              subtitle="Insumos que se descuentan por receta.">
              <EmptyState size="sm" icon={<ClipboardList size={22} />} title="Sin ingredientes"
                description="Marca productos como insumo para empezar." />
            </SectionCard>
          </div>
        </Block>
      </div>
    </div>
  );
}
