// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { getRememberedEmail, rememberEmail, forgetRememberedEmail } from './rememberedLogin';

beforeEach(() => localStorage.clear());

describe('correo recordado del inicio de sesión', () => {
  it('sin nada guardado devuelve vacío', () => {
    expect(getRememberedEmail()).toBe('');
  });

  it('guarda y devuelve el último correo (sin espacios)', () => {
    rememberEmail('  dueno@negocio.test ');
    expect(getRememberedEmail()).toBe('dueno@negocio.test');
  });

  it('un correo vacío no borra el que había', () => {
    rememberEmail('dueno@negocio.test');
    rememberEmail('   ');
    expect(getRememberedEmail()).toBe('dueno@negocio.test');
  });

  it('se puede olvidar', () => {
    rememberEmail('dueno@negocio.test');
    forgetRememberedEmail();
    expect(getRememberedEmail()).toBe('');
  });

  it('solo guarda el correo: ninguna clave del almacenamiento contiene contraseñas', () => {
    rememberEmail('dueno@negocio.test');
    expect(Object.keys(localStorage)).toEqual(['senio_last_email']);
  });
});
