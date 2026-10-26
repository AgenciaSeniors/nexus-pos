import { describe, it, expect } from 'vitest';
import { EscPos, encodeText, wrapText, rowLines, stripAccents } from './escpos';
import { columnsFor, normalizePrinterConfig, isValidIPv4, isPrinterReady } from './config';

const hex = (b: ArrayLike<number>) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(' ');

describe('encodeText', () => {
  it('ASCII pasa tal cual', () => {
    expect(Array.from(encodeText('Hola 123', 'cp858'))).toEqual(Array.from('Hola 123').map(c => c.charCodeAt(0)));
  });
  it('CP858: tildes, ñ y signos de español', () => {
    expect(hex(encodeText('áéíóú', 'cp858'))).toBe('a0 82 a1 a2 a3');
    expect(hex(encodeText('ÁÉÍÓÚ', 'cp858'))).toBe('b5 90 d6 e0 e9');
    expect(hex(encodeText('ñÑ¿¡', 'cp858'))).toBe('a4 a5 a8 ad');
  });
  it('CP437 degrada las mayúsculas acentuadas que no existen', () => {
    expect(hex(encodeText('Á', 'cp437'))).toBe('41');
    expect(hex(encodeText('é', 'cp437'))).toBe('82');
  });
  it('modo ascii quita tildes y la ñ pasa a n', () => {
    expect(String.fromCharCode(...encodeText('Canción ñandú ¿Qué?', 'ascii'))).toBe('Cancion nandu ?Que?');
  });
  it('símbolos fuera de tabla se sustituyen o salen como ?', () => {
    expect(String.fromCharCode(...encodeText('“a” – b …', 'cp858'))).toBe('"a" - b ...');
    expect(String.fromCharCode(...encodeText('日', 'cp858'))).toBe('?');
  });
  it('stripAccents', () => { expect(stripAccents('Ñandú Ó')).toBe('Nandu O'); });
});

describe('EscPos', () => {
  it('arranca con reset y selecciona la tabla (ESC t 19 para CP858)', () => {
    expect(hex(new EscPos({ columns: 48, codepage: 'cp858' }).build())).toBe('1b 40 1b 74 13');
    expect(hex(new EscPos({ columns: 48, codepage: 'ascii' }).build())).toBe('1b 40');
  });
  it('comandos de formato', () => {
    const b = new EscPos({ columns: 48, codepage: 'ascii' }).align('center').bold(true).size(2).size(1).bold(false).build();
    expect(hex(b)).toBe('1b 40 1b 61 01 1b 45 01 1d 21 11 1d 21 00 1b 45 00');
  });
  it('corte: avanza y GS V 66 0', () => {
    const b = new EscPos({ columns: 48, codepage: 'ascii' }).cut(2).build();
    expect(hex(b)).toBe('1b 40 0a 0a 1d 56 42 00');
  });
  it('gaveta: ESC p 0 50 250', () => {
    expect(hex(new EscPos({ columns: 48, codepage: 'ascii' }).drawer().build())).toBe('1b 40 1b 70 00 32 fa');
  });
  it('row alinea el importe a todo el ancho', () => {
    const l = rowLines('2 x Pan', '$3.00', 48);
    expect(l).toHaveLength(1);
    expect(l[0]).toHaveLength(48);
    expect(l[0].startsWith('2 x Pan')).toBe(true);
    expect(l[0].endsWith('$3.00')).toBe(true);
  });
  it('row envuelve nombres largos y deja el importe en la última línea', () => {
    const l = rowLines('1 x Aceite de oliva extra virgen botella grande de un litro', '$12.50', 32);
    expect(l.length).toBeGreaterThan(1);
    expect(l.every(x => x.length <= 32)).toBe(true);
    expect(l[l.length - 1].endsWith('$12.50')).toBe(true);
    expect(l[l.length - 1]).toHaveLength(32);
  });
  it('nunca excede el ancho aunque una palabra sea enorme', () => {
    expect(wrapText('x'.repeat(100), 48).every(x => x.length <= 48)).toBe(true);
  });
});

describe('config de la impresora', () => {
  it('80 mm = 48 columnas, 58 mm = 32', () => {
    expect(columnsFor('80mm')).toBe(48);
    expect(columnsFor('58mm')).toBe(32);
  });
  it('IPv4 válida', () => {
    expect(isValidIPv4('192.168.1.50')).toBe(true);
    expect(isValidIPv4(' 10.0.0.1 ')).toBe(true);
    expect(isValidIPv4('192.168.1.256')).toBe(false);
    expect(isValidIPv4('abc')).toBe(false);
    expect(isValidIPv4('')).toBe(false);
  });
  it('la configuración vieja (IP de ejemplo, sin "enabled") queda apagada y sin IP', () => {
    const c = normalizePrinterConfig({ name: 'Impresora Térmica', ip: '192.168.1.200', width: '80mm', autoPrint: true });
    expect(c.enabled).toBe(false);
    expect(c.ip).toBe('');
    expect(c.port).toBe(9100);
    expect(isPrinterReady(c)).toBe(false);
  });
  it('se considera lista solo si está activada y con IP válida', () => {
    expect(isPrinterReady(normalizePrinterConfig({ enabled: true, ip: '192.168.1.50' }))).toBe(true);
    expect(isPrinterReady(normalizePrinterConfig({ enabled: true, ip: '' }))).toBe(false);
    expect(isPrinterReady(normalizePrinterConfig({ enabled: false, ip: '192.168.1.50' }))).toBe(false);
  });
  it('valores corruptos caen a los por defecto', () => {
    const c = normalizePrinterConfig({ port: -5, codepage: 'xx', width: '99mm' });
    expect(c.port).toBe(9100);
    expect(c.codepage).toBe('cp858');
    expect(c.width).toBe('80mm');
  });
});
