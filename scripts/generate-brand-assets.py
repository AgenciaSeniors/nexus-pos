"""
Genera TODOS los recursos de la identidad visual de Senio a partir de los
originales de `brand/`:

    brand/senio-s.png          la "S" azul con fondo transparente (original, sin tocar)
    brand/senio-wordmark.webp  logo horizontal "senio." (fondo blanco)
    brand/favicon.ico          icono de escritorio / pestaña

Uso (desde la raíz del proyecto):  python scripts/generate-brand-assets.py

Escribe en:
  - android/app/src/main/res/mipmap-*/       iconos (adaptativos y clásicos)
  - android/app/src/main/res/drawable*/      pantalla de inicio (splash)
  - public/                                  favicon, icono PWA, apple-touch, icono de Windows
  - src/assets/                              logos dentro de la app

La "S" nunca se redibuja ni se recolorea: solo se recorta, se escala y se coloca.
Requiere Pillow (pip install pillow).

ICONO ADAPTATIVO (Android 8+): lienzo de 108 dp; el sistema lo recorta con la máscara
del lanzador (círculo, cuadrado, esquinas redondeadas...), y solo garantiza visible un
círculo de 66 dp en el centro. La S se coloca con una altura de 52 dp: su caja (la S es
más alta que ancha) queda holgadamente dentro de ese círculo.
"""
import glob
import os
import shutil
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, "brand")
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
PUBLIC = os.path.join(ROOT, "public")
ASSETS = os.path.join(ROOT, "src", "assets")

WHITE = (255, 255, 255, 255)


def load_s() -> Image.Image:
    """La S recortada a su caja (sin el margen transparente del original)."""
    im = Image.open(os.path.join(BRAND, "senio-s.png")).convert("RGBA")
    box = im.split()[3].point(lambda v: 255 if v > 8 else 0).getbbox()
    return im.crop(box)


S = load_s()


def s_scaled(height: int) -> Image.Image:
    w = round(S.width * height / S.height)
    return S.resize((w, height), Image.LANCZOS)


def paste_centered(canvas: Image.Image, glyph: Image.Image) -> None:
    x = (canvas.width - glyph.width) // 2
    y = (canvas.height - glyph.height) // 2
    canvas.alpha_composite(glyph, (x, y))


def s_on(size_w: int, size_h: int, s_height: int, bg=WHITE) -> Image.Image:
    canvas = Image.new("RGBA", (size_w, size_h), bg)
    paste_centered(canvas, s_scaled(s_height))
    return canvas


def save(img: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    print("  ", os.path.relpath(path, ROOT), img.size)


# ───────────────────────── Android: iconos ─────────────────────────
DENSITIES = {  # nombre: factor sobre mdpi (48 px de icono clásico, 108 px de capa adaptativa)
    "ldpi": 0.75, "mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0,
}


def android_icons() -> None:
    print("Android: iconos")
    for name, f in DENSITIES.items():
        folder = os.path.join(RES, f"mipmap-{name}")

        # Primer plano adaptativo: 108 dp, transparente, S de 52 dp centrada
        layer = round(108 * f)
        fg = Image.new("RGBA", (layer, layer), (0, 0, 0, 0))
        paste_centered(fg, s_scaled(round(52 * f)))
        save(fg, os.path.join(folder, "ic_launcher_foreground.png"))

        # El fondo blanco ahora es un color (ic_launcher_background): el PNG sobra
        bg_png = os.path.join(folder, "ic_launcher_background.png")
        if os.path.exists(bg_png):
            os.remove(bg_png)

        # Icono clásico (Android 7.x, sin adaptativos): cuadrado blanco de esquinas redondeadas
        icon = round(48 * f)
        sq = Image.new("RGBA", (icon * 4, icon * 4), (0, 0, 0, 0))     # supermuestreo para bordes suaves
        ImageDraw.Draw(sq).rounded_rectangle([0, 0, icon * 4 - 1, icon * 4 - 1], radius=round(icon * 4 * 0.16), fill=WHITE)
        paste_centered(sq, s_scaled(round(icon * 4 * 0.62)))
        save(sq.resize((icon, icon), Image.LANCZOS), os.path.join(folder, "ic_launcher.png"))

        # Icono clásico redondo
        circ = Image.new("RGBA", (icon * 4, icon * 4), (0, 0, 0, 0))
        ImageDraw.Draw(circ).ellipse([0, 0, icon * 4 - 1, icon * 4 - 1], fill=WHITE)
        paste_centered(circ, s_scaled(round(icon * 4 * 0.52)))
        save(circ.resize((icon, icon), Image.LANCZOS), os.path.join(folder, "ic_launcher_round.png"))

    # XML del icono adaptativo: fondo = color blanco, primer plano = la S, SIN inset
    # (el margen ya va dentro del PNG)
    xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background" />\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
        '</adaptive-icon>\n'
    )
    for n in ("ic_launcher.xml", "ic_launcher_round.xml"):
        with open(os.path.join(RES, "mipmap-anydpi-v26", n), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(xml)
    print("   mipmap-anydpi-v26/ic_launcher(.|_round).xml")


# ───────────────────────── Android: splash ─────────────────────────
def android_splash() -> None:
    """Fondo blanco con la S centrada, en TODOS los tamaños/orientaciones (día y noche)."""
    print("Android: pantalla de inicio")
    n = 0
    for p in sorted(glob.glob(os.path.join(RES, "**", "splash.png"), recursive=True)):
        w, h = Image.open(p).size
        img = s_on(w, h, round(min(w, h) * 0.28))
        img.convert("RGB").save(p, optimize=True)
        n += 1
    print(f"   {n} imágenes splash.png regeneradas")


# ───────────────────────── Web / PWA / Windows ─────────────────────────
def web_assets() -> None:
    print("Web / PWA / Windows")
    # Icono de escritorio (Electron/NSIS necesita 256 px) y favicon: el .ico que ya venía hecho
    shutil.copyfile(os.path.join(BRAND, "favicon.ico"), os.path.join(PUBLIC, "icon.ico"))
    shutil.copyfile(os.path.join(BRAND, "favicon.ico"), os.path.join(PUBLIC, "favicon.ico"))
    print("   public/icon.ico, public/favicon.ico")

    save(s_on(192, 192, round(192 * 0.62)), os.path.join(PUBLIC, "pwa-192x192.png"))
    save(s_on(512, 512, round(512 * 0.62)), os.path.join(PUBLIC, "pwa-512x512.png"))
    # Maskable: la zona segura es el círculo central del 80 %: la S más pequeña
    save(s_on(512, 512, round(512 * 0.50)), os.path.join(PUBLIC, "pwa-maskable-512x512.png"))
    save(s_on(180, 180, round(180 * 0.62)), os.path.join(PUBLIC, "apple-touch-icon.png"))
    save(s_on(64, 64, round(64 * 0.80), bg=(0, 0, 0, 0)), os.path.join(PUBLIC, "favicon-64.png"))


# ───────────────────────── Dentro de la app ─────────────────────────
def app_logos() -> None:
    print("Logos dentro de la app")
    # La S sola, transparente y recortada con un margen mínimo (cabe en cajas pequeñas)
    side = round(S.height * 1.08)
    logo = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    paste_centered(logo, S)
    save(logo.resize((384, 384), Image.LANCZOS), os.path.join(ASSETS, "logo.png"))

    # Logo horizontal "senio.": recortado al contenido (fondo blanco)
    wm = Image.open(os.path.join(BRAND, "senio-wordmark.webp")).convert("RGB")
    non_white = Image.eval(wm.convert("L"), lambda v: 255 if v < 245 else 0).getbbox()
    pad = 24
    box = (max(0, non_white[0] - pad), max(0, non_white[1] - pad),
           min(wm.width, non_white[2] + pad), min(wm.height, non_white[3] + pad))
    save(wm.crop(box).convert("RGBA"), os.path.join(ASSETS, "logo-senio.png"))


if __name__ == "__main__":
    android_icons()
    android_splash()
    web_assets()
    app_logos()
    print("Listo.")
