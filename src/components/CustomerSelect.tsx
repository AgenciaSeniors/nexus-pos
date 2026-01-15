import { useState, useEffect, useRef } from 'react';
import { db, type Customer } from '../lib/db';
import { Search, UserPlus, X, Check } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';

interface Props {
  onSelect: (customer: Customer | null) => void;
  selectedCustomer: Customer | null;
}

export function CustomerSelect({ onSelect, selectedCustomer }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  
  // ✅ 1. OBTENER BUSINESS ID (Aislamiento)
  const businessId = localStorage.getItem('nexus_business_id');

  // ✅ 2. CONSULTA BLINDADA
  // Solo trae clientes del negocio actual y que no estén borrados
  const customers = useLiveQuery(async () => {
    if (!businessId || !isOpen) return []; // Optimización: Solo cargar si está abierto
    
    return await db.customers
      .where('business_id').equals(businessId)
      .filter(c => !c.deleted_at)
      .toArray();
  }, [businessId, isOpen]) || [];

  // Filtro en memoria para búsqueda rápida
  const filtered = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone?.includes(searchTerm)
  ).slice(0, 5); // Solo mostramos los 5 mejores resultados

  // Cerrar al hacer click fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  return (
    <div className="relative w-full" ref={wrapperRef}>
      {selectedCustomer ? (
        // MODO: CLIENTE SELECCIONADO
        <div className="flex items-center justify-between p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold">
                    {selectedCustomer.name.substring(0,2).toUpperCase()}
                </div>
                <div>
                    <div className="font-bold text-indigo-900 text-sm">{selectedCustomer.name}</div>
                    {selectedCustomer.phone && <div className="text-xs text-indigo-600">{selectedCustomer.phone}</div>}
                </div>
            </div>
            <button onClick={() => onSelect(null)} className="p-2 hover:bg-white rounded-full text-indigo-400 hover:text-red-500 transition-colors">
                <X size={18} />
            </button>
        </div>
      ) : (
        // MODO: BUSCADOR
        <div>
            <div 
                onClick={() => setIsOpen(true)}
                className={`flex items-center gap-2 p-3 bg-white border rounded-xl cursor-text transition-all ${isOpen ? 'ring-2 ring-indigo-500 border-transparent' : 'border-slate-200 hover:border-slate-300'}`}
            >
                <Search size={20} className="text-slate-400" />
                <input 
                    type="text" 
                    placeholder="Buscar cliente (Nombre o Tel)..." 
                    className="flex-1 outline-none text-sm bg-transparent"
                    value={searchTerm}
                    onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                />
            </div>

            {/* DROPDOWN DE RESULTADOS */}
            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                    {customers.length === 0 ? (
                        <div className="p-4 text-center text-slate-400 text-sm">
                            No hay clientes registrados.
                        </div>
                    ) : filtered.length > 0 ? (
                        <ul>
                            {filtered.map(c => (
                                <li 
                                    key={c.id}
                                    onClick={() => {
                                        onSelect(c);
                                        setIsOpen(false);
                                        setSearchTerm('');
                                    }}
                                    className="p-3 hover:bg-indigo-50 cursor-pointer flex items-center justify-between group transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 text-xs font-bold group-hover:bg-indigo-200 group-hover:text-indigo-700">
                                            {c.name.substring(0,2).toUpperCase()}
                                        </div>
                                        <div>
                                            <div className="font-bold text-slate-700 text-sm group-hover:text-indigo-900">{c.name}</div>
                                            {c.phone && <div className="text-xs text-slate-400 group-hover:text-indigo-600">{c.phone}</div>}
                                        </div>
                                    </div>
                                    <Check size={16} className="text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"/>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="p-4 text-center text-slate-400 text-sm">
                            No se encontró a "{searchTerm}"
                        </div>
                    )}
                    
                    {/* Botón rápido para crear (Opcional, redirigiría a CustomersPage) */}
                    <div className="p-2 border-t border-slate-50 bg-slate-50/50">
                        <button className="w-full py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 rounded-lg flex items-center justify-center gap-2">
                            <UserPlus size={14} /> Gestión Avanzada de Clientes
                        </button>
                    </div>
                </div>
            )}
        </div>
      )}
    </div>
  );
}