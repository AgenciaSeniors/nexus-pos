import net from 'net';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Manda bytes ESC/POS a una impresora de red por TCP "raw" (puerto 9100).
 * Devuelve { ok: true } o { ok: false, error } con un código que la app traduce a un
 * mensaje legible (TIMEOUT, REFUSED, UNREACHABLE, INVALID, ...). Nunca lanza.
 */
export function sendRaw(host, port, bytes, timeoutMs = 5000) {
    return new Promise((resolve) => {
        const m = IPV4.exec(String(host || '').trim());
        const p = Number(port);
        if (!m || m.slice(1).some((x) => Number(x) > 255) || !Number.isInteger(p) || p < 1 || p > 65535) {
            resolve({ ok: false, error: 'INVALID' });
            return;
        }
        if (!Array.isArray(bytes) && !(bytes instanceof Uint8Array)) {
            resolve({ ok: false, error: 'INVALID' });
            return;
        }

        const socket = new net.Socket();
        let done = false;
        const finish = (result) => {
            if (done) return;
            done = true;
            socket.destroy();
            resolve(result);
        };

        socket.setTimeout(timeoutMs);
        socket.once('timeout', () => finish({ ok: false, error: 'TIMEOUT' }));
        socket.once('error', (err) => {
            const code = err && err.code;
            if (code === 'ECONNREFUSED') finish({ ok: false, error: 'REFUSED' });
            else if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') finish({ ok: false, error: 'UNREACHABLE' });
            else if (code === 'ETIMEDOUT') finish({ ok: false, error: 'TIMEOUT' });
            else finish({ ok: false, error: String((err && err.message) || code || 'ERROR') });
        });
        socket.connect(p, m[0], () => {
            // end() vacía el buffer y cierra: la impresora no necesita nada más.
            socket.end(Buffer.from(bytes), () => finish({ ok: true }));
        });
    });
}
