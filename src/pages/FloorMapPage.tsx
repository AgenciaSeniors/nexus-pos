import { UtensilsCrossed } from 'lucide-react';

/**
 * Plano de mesas (modo restaurante).
 *
 * Stub de la Fase 0: el andamiaje del modo restaurante ya enruta aquí cuando
 * `business_type === 'restaurant'`. La funcionalidad real (áreas, mesas, estados,
 * abrir comanda) llega en la Fase 1.
 */
export default function FloorMapPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-[#0B3B68]/5 flex items-center justify-center mb-4">
        <UtensilsCrossed className="text-[#0B3B68]" size={32} />
      </div>
      <h1 className="text-xl font-bold text-[#1F2937] mb-1">Plano de Mesas</h1>
      <p className="text-sm text-[#6B7280] max-w-sm">
        El modo restaurante está activado. La gestión de áreas, mesas y comandas
        estará disponible muy pronto.
      </p>
    </div>
  );
}
