"""
Generate the PWA icon set from the app's own logo mark.

Run from frontend/:  python scripts/make-icons.py

WHY THIS IS A SCRIPT AND NOT HAND-DRAWN FILES
=============================================
The mark is a yellow disc carrying a dial arc and a bolt — the same figure
components/Logo.tsx draws in SVG. Keeping a script means the raster set can be
regenerated from one definition when the brand changes, instead of five PNGs
drifting away from the component they are supposed to match.

MASKABLE IS A SEPARATE FILE ON PURPOSE
======================================
Android crops an icon to whatever shape the launcher uses — circle, squircle,
rounded square. A maskable icon must keep everything important inside the middle
40% radius "safe zone", so the mark is drawn smaller on a filled background.
Shipping the normal icon as maskable is the usual mistake: the launcher crops
into the artwork and clips the bolt.

Pillow is a build-time tool for this one job, not a runtime dependency, so it is
deliberately absent from requirements.txt. The generated PNGs are committed.
"""

import os

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
ACCENT = (227, 236, 74, 255)   # --accent  #e3ec4a
INK = (28, 32, 40, 255)        # dark mark
FIELD = (11, 16, 22, 255)      # --sky/panel backdrop for the maskable field

# Bolt outline on a 48x48 grid, matching components/Logo.tsx.
BOLT = [(26.6, 11.5), (17.6, 25.4), (22.9, 25.4), (21.3, 36.5), (30.4, 22.3), (25.0, 22.3)]


def draw_mark(size: int, inset: float, background):
    """
    Render the mark at `size` px. `inset` is the fraction of the canvas the disc
    occupies; the maskable variant uses a smaller disc so the launcher's crop
    cannot reach the artwork.
    """
    # 4x supersample, then downscale — Pillow has no antialiased vector fill, and
    # a hard-edged disc at 192 px looks visibly jagged next to other app icons.
    ss = 4
    n = size * ss
    img = Image.new("RGBA", (n, n), background)
    d = ImageDraw.Draw(img)

    disc = n * inset
    off = (n - disc) / 2
    d.ellipse([off, off, off + disc, off + disc], fill=ACCENT)

    # unit -> canvas, using the 48-grid the SVG mark is authored on
    def pt(x, y):
        return (off + x / 48 * disc, off + y / 48 * disc)

    # dial arc: 240 degrees, open at the bottom
    pad = disc * 0.20
    d.arc(
        [off + pad, off + pad, off + disc - pad, off + disc - pad],
        start=150, end=30, fill=INK, width=max(2, int(disc * 0.062)),
    )

    d.polygon([pt(x, y) for x, y in BOLT], fill=INK)

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    made = []

    for size in (192, 512):
        p = os.path.join(OUT, f"icon-{size}.png")
        draw_mark(size, inset=1.0, background=(0, 0, 0, 0)).save(p)
        made.append(p)

    # Maskable: mark at 62% on a filled field, so the safe zone holds it.
    p = os.path.join(OUT, "maskable-512.png")
    draw_mark(512, inset=0.62, background=FIELD).save(p)
    made.append(p)

    # Apple touch icons are never transparent — iOS composites them on black.
    p = os.path.join(OUT, "apple-touch-icon.png")
    draw_mark(180, inset=0.86, background=FIELD).save(p)
    made.append(p)

    # Favicon, multi-resolution.
    p = os.path.join(OUT, "..", "favicon.ico")
    draw_mark(64, inset=1.0, background=(0, 0, 0, 0)).save(
        p, sizes=[(16, 16), (32, 32), (48, 48), (64, 64)]
    )
    made.append(os.path.normpath(p))

    for f in made:
        print("wrote", os.path.relpath(f, os.path.join(os.path.dirname(__file__), "..")),
              os.path.getsize(f), "bytes")


if __name__ == "__main__":
    main()
