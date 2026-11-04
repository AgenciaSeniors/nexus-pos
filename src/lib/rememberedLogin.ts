/**
 * Recordar el correo de la última cuenta que entró, para no tener que escribirlo cada vez
 * que se cierra sesión.
 *
 * SOLO se guarda el correo. La contraseña NO se guarda nunca dentro de la app: quedaría en
 * texto legible en el almacenamiento del teléfono. Para eso está el gestor de contraseñas del
 * sistema (Google/Samsung/Chrome), que la guarda cifrada y la rellena sola: los campos del
 * inicio de sesión llevan los atributos `autocomplete` que ese gestor necesita para ofrecer
 * guardarla y rellenarla.
 */
const KEY = 'senio_last_email';

export function getRememberedEmail(): string {
  try {
    return (localStorage.getItem(KEY) || '').trim();
  } catch {
    return '';
  }
}

export function rememberEmail(email: string): void {
  const clean = (email || '').trim();
  if (!clean) return;
  try {
    localStorage.setItem(KEY, clean);
  } catch { /* sin almacenamiento: simplemente no se recuerda */ }
}

export function forgetRememberedEmail(): void {
  try {
    localStorage.removeItem(KEY);
  } catch { /* nada */ }
}
