// src/lib/currency.ts

/**
 * Convierte un monto decimal (ej: 10.50) a centavos enteros (1050).
 * Esto elimina los errores de punto flotante de JS.
 */
export const toCents = (amount: number): number => {
  return Math.round(amount * 100);
};

/**
 * Convierte centavos (1050) de vuelta a decimal (10.50) para mostrar en pantalla.
 */
export const fromCents = (cents: number): number => {
  return cents / 100;
};

/**
 * Suma dos montos de forma segura.
 * Uso: safeAdd(19.99, 9.99) -> Retorna 29.98 (exacto)
 */
export const safeAdd = (a: number, b: number): number => {
  return fromCents(toCents(a) + toCents(b));
};

/**
 * Resta dos montos de forma segura.
 */
export const safeSub = (a: number, b: number): number => {
  return fromCents(toCents(a) - toCents(b));
};

/**
 * Multiplica (ej: Precio x Cantidad) de forma segura.
 */
export const safeMul = (amount: number, quantity: number): number => {
  // Cantidad suele ser entero, pero por si acaso tratamos todo con cuidado
  return fromCents(Math.round(toCents(amount) * quantity));
};

/**
 * Formatea dinero para mostrar al usuario (ej: "$ 1,250.00")
 */
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(amount);
};