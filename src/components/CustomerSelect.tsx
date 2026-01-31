import { useState, useEffect, useRef } from 'react';
import { db, type Customer } from '../lib/db';
import { Search, X, User, Check, UserPlus } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';

interface Props {
  onSelect: (customer: Customer | null) => void;
  selectedCustomer: Customer | null;
}

export function CustomerSelect({ onSelect, selectedCustomer }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const businessId = localStorage.getItem('nexus_business_id');

  // Buscar clientes en tiempo real
  const customers = useLiveQuery(async () => {
    if (!search || search.length < 2 || !businessId) return [];
    
    return await db.customers
      .where('business_id').equals(businessId)
      .filter(c => {
        // 1. Verificamos que no esté borrado
        if (c.deleted_at) return false;

        // 2. Normalizamos la búsqueda
        const term = search.toLowerCase();
        
        // 3. Comprobamos nombre (siempre existe y es string)
        const matchName = c.name.toLowerCase().includes(term);
        
        // 4. Comprobamos teléfono (es opcional, aseguramos booleano)
        // Usamos (c.phone || '') para evitar 'undefined' y .includes() devuelve boolean
        const matchPhone = c.phone ? c.phone.includes(term) : false;

        // 5. Retornamos BOOLEANO estricto
        return matchName || matchPhone;
      })
      .limit(5)
      .toArray();
  }, [search, businessId]);

  // Manejar clic fuera para cerrar
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Atajo de teclado F3
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSelect = (customer: Customer) => {
    onSelect(customer);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = () => {
    onSelect(null);
    setSearch('');
    inputRef.current?.focus();
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      
      {/* 1. MODO: CLIENTE SELECCIONADO */}
      {selectedCustomer ? (
        <div className="flex items-center justify-between bg-indigo-50 border border-indigo-100 p-3 rounded-xl animate-in fade-in zoom-in duration-200">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
              <User className="text-indigo-600 w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-indigo-900 truncate text-sm">{selectedCustomer.name}</p>
              <p className="text-xs text-indigo-500 font-medium flex items-center gap-1">
                 💎 {selectedCustomer.loyalty_points || 0} Puntos
              </p>
            </div>
          </div>
          <button 
            onClick={handleClear}
            className="p-2 hover:bg-white rounded-full text-indigo-400 hover:text-red-500 transition-colors"
            title="Desvincular cliente"
          >
            <X size={18} />
          </button>
        </div>
      ) : (
        
        /* 2. MODO: BUSCADOR */
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <Search size={18} />
          </div>
          <input
            ref={inputRef}
            type="text"
            className="w-full pl-10 pr-10 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm"
            placeholder="Buscar Cliente (F3)..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!isOpen) setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
          />
          {search && (
             <button 
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
             >
                <X size={14} />
             </button>
          )}
        </div>
      )}

      {/* 3. DROPDOWN DE RESULTADOS */}
      {isOpen && search.length > 1 && !selectedCustomer && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden">
          {customers && customers.length > 0 ? (
            <ul className="divide-y divide-slate-50">
              {customers.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => handleSelect(c)}
                    className="w-full text-left p-3 hover:bg-indigo-50 transition-colors flex items-center gap-3 group"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-100 group-hover:bg-indigo-100 flex items-center justify-center text-slate-500 group-hover:text-indigo-600 transition-colors">
                        <User size={16} />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-slate-700 group-hover:text-indigo-900">{c.name}</p>
                        <p className="text-xs text-slate-400 flex gap-2">
                            {c.phone && <span>📞 {c.phone}</span>}
                            <span>💎 {c.loyalty_points || 0} pts</span>
                        </p>
                    </div>
                    <Check className="ml-auto text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4 text-center text-slate-400 text-sm">
                {search.length > 2 ? (
                    <div className="flex flex-col items-center gap-2">
                        <UserPlus className="w-8 h-8 text-slate-300" />
                        <p>No encontrado</p>
                        <p className="text-xs">Ve a Clientes para crearlo</p>
                    </div>
                ) : (
                    "Escribe para buscar..."
                )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}