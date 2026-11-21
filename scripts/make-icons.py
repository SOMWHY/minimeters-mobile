#!/usr/bin/env python3
"""Derive every app-icon asset from one square source image.

The source is a flat-colour illustration (a gauge on charcoal), so the layers are
recovered by keying on colour rather than by hand: the artwork is the only part of
the picture where red runs ahead of blue, which separates it from the background
*and* from the white corners a pre-rounded source brings with it.

Run from the project root:

    python scripts/make-icons.py "D:/path/to/source.jpg"

Outputs (overwritten):
    assets/images/icon.png                       1024  opaque, square corners
    assets/images/android-icon-foreground.png    1024  transparent, inside the safe zone
    assets/images/android-icon-background.png    1024  opaque backdrop
    assets/images/android-icon-monochrome.png    1024  white silhouette for themed icons
    assets/images/splash-icon.png                 512  transparent mark
    assets/images/favicon.png                     196  web favicon
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets" / "images"

# Android's adaptive icon only guarantees the centre 66% survives the launcher
# mask, so the artwork has to sit well inside that circle.
SAFE_ZONE = 0.62
ICON_ART = 0.72
MONO_ART = 0.60
SPLASH_ART = 0.92

# Keying thresholds on (R - B). Background measures about -8, the artwork 160.
# The floor is high on purpose: the source has a faint glow around the arc, and
# anything below this is glow, not shape.
KEY_LOW = 22
KEY_HIGH = 72

# The artwork is flat orange. Its colour is not read from the source at all:
# JPEG ringing around the arc survives un-mixing as a grey halo, so every painted
# pixel gets the brand colour and only the alpha mask is derived from the image.
CANONICAL = (240, 150, 80)

# Below this the pixel is ringing or glow. Dropped, so no smudge reaches the edge.
NOISE_FLOOR = 55


def key_artwork(source: Image.Image) -> Image.Image:
    """Return the artwork as flat-colour RGBA with the backdrop removed."""
    rgb = source.convert("RGB")
    width, height = rgb.size
    pixels = list(rgb.getdata())

    alphas = []

    for r, _g, b in pixels:
        alpha = (r - b - KEY_LOW) / (KEY_HIGH - KEY_LOW)
        alpha = 0.0 if alpha < 0 else 1.0 if alpha > 1 else alpha
        alphas.append(round(alpha * 255))

    mask = Image.new("L", (width, height))
    mask.putdata(alphas)
    mask = mask.point(lambda value: 0 if value < NOISE_FLOOR else value)
    # A touch of blur turns the hard-won binary-ish edge back into an anti-aliased
    # one, which is what the launcher will scale down anyway.
    mask = mask.filter(ImageFilter.GaussianBlur(0.6))

    out = Image.new("RGBA", (width, height), (*CANONICAL, 0))
    out.putalpha(mask)
    return out


def trim(image: Image.Image) -> Image.Image:
    """Crop to the artwork's bounding box, ignoring the soft glow around it."""
    bbox = image.split()[3].point(lambda value: 255 if value > 40 else 0).getbbox()

    if bbox is None:
        raise SystemExit("No artwork found: the source has no orange pixels to key out.")

    return image.crop(bbox)


def fit(artwork: Image.Image, canvas: int, fraction: float) -> Image.Image:
    """Scale the artwork into a transparent square, centred."""
    target = canvas * fraction
    scale = min(target / artwork.width, target / artwork.height)
    resized = artwork.resize(
        (max(1, round(artwork.width * scale)), max(1, round(artwork.height * scale))),
        Image.LANCZOS,
    )

    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.alpha_composite(
        resized,
        ((canvas - resized.width) // 2, (canvas - resized.height) // 2),
    )
    return out


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)

    source_path = Path(sys.argv[1])

    if not source_path.exists():
        raise SystemExit(f"Source not found: {source_path}")

    source = Image.open(source_path)
    artwork = trim(key_artwork(source))

    ASSETS.mkdir(parents=True, exist_ok=True)

    # 1. The store icon: opaque, square, no rounded corners baked in.
    backdrop = Image.new("RGBA", (1024, 1024), (33, 33, 41, 255))
    backdrop.alpha_composite(fit(artwork, 1024, ICON_ART))
    backdrop.convert("RGB").save(ASSETS / "icon.png", optimize=True)

    # 2. Adaptive foreground: transparent, inside the mask's safe zone.
    fit(artwork, 1024, SAFE_ZONE).save(ASSETS / "android-icon-foreground.png", optimize=True)

    # 3. Adaptive background: the icon's own charcoal, flat.
    Image.new("RGBA", (1024, 1024), (33, 33, 41, 255)).save(
        ASSETS / "android-icon-background.png", optimize=True
    )

    # 4. Themed icon: shape only, the launcher supplies the colour.
    mono = fit(artwork, 1024, MONO_ART)
    mono.putdata([(255, 255, 255, alpha) for _, _, _, alpha in mono.getdata()])
    mono.save(ASSETS / "android-icon-monochrome.png", optimize=True)

    # 5. Splash mark, transparent.
    fit(artwork, 512, SPLASH_ART).save(ASSETS / "splash-icon.png", optimize=True)

    # 6. Web favicon.
    fit(artwork, 196, 0.96).save(ASSETS / "favicon.png", optimize=True)

    for name in (
        "icon.png",
        "android-icon-foreground.png",
        "android-icon-background.png",
        "android-icon-monochrome.png",
        "splash-icon.png",
        "favicon.png",
    ):
        path = ASSETS / name
        with Image.open(path) as written:
            print(f"{name:34} {written.size[0]}x{written.size[1]}  {path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
