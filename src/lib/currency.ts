// Librería de Manejo Seguro de Moneda
// Evita errores de punto flotante (0.1 + 0.2 = 0.300000004)

const LOCALE = 'es-MX'; // Ajusta a tu país (es-AR, es-CL, es-CO, etc.)
const CURRENCY = 'MXN'; // Ajusta a tu moneda (ARS, CLP, COP, etc.)

export const currency = {
  /**
   * Convierte un monto en dólares/pesos a centavos (enteros)
   * Ej: 10.50 -> 1050
   */
  toCents: (amount: number): number => {
    return Math.round(amount * 100);
  },

  /**
   * Convierte centavos a monto decimal
   * Ej: 1050 -> 10.50
   */
  fromCents: (cents: number): number => {
    return cents / 100;
  },

  /**
   * Formatea un número para mostrar en pantalla
   * Ej: 1250.5 -> "$1,250.50"
   */
  format: (amount: number): string => {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: CURRENCY,
      minimumFractionDigits: 2
    }).format(amount);
  },

  /**
   * Suma segura de dos montos decimales
   */
  add: (a: number, b: number): number => {
    const aCents = Math.round(a * 100);
    const bCents = Math.round(b * 100);
    return (aCents + bCents) / 100;
  },

  /**
   * Resta segura (a - b)
   */
  subtract: (a: number, b: number): number => {
    const aCents = Math.round(a * 100);
    const bCents = Math.round(b * 100);
    return (aCents - bCents) / 100;
  },

  /**
   * Multiplicación segura (Precio * Cantidad)
   */
  multiply: (price: number, quantity: number): number => {
    // Convertimos precio a centavos, multiplicamos y regresamos a decimal
    const priceCents = Math.round(price * 100);
    return (priceCents * quantity) / 100;
  },

  /**
   * Calcula el total de un carrito de compras de forma segura
   */
  calculateTotal: (items: { price: number; quantity: number }[]): number => {
    const totalCents = items.reduce((sum, item) => {
      const itemTotalCents = Math.round(item.price * 100) * item.quantity;
      return sum + itemTotalCents;
    }, 0);
    
    return totalCents / 100;
  }
};