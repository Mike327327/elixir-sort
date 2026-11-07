"""
Vygeneruje PNG ikony aplikace z SVG (public/icons/*.png).
Potřebuje Python + Playwright s Chromiem:  pip install playwright && playwright install chromium
Použití:  python3 scripts/make-icons.py
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "icons"

FLASK = """
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f0dcfc"/><stop offset="1" stop-color="#b384e4"/>
  </linearGradient>
  <radialGradient id="glow" cx="50%" cy="38%" r="60%">
    <stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="in"><path d="M78 40h44v52l42 78c8 16-2 30-20 30H56c-18 0-28-14-20-30l42-78Z"/></clipPath>
</defs>
"""

BODY = """
<g clip-path="url(#in)">
  <rect width="200" height="220" fill="#fff" fill-opacity=".4"/>
  <rect y="176" width="200" height="40" fill="#a88af5"/>
  <rect y="150" width="200" height="27" fill="#78b0f7"/>
  <rect y="124" width="200" height="27" fill="#ffd95e"/>
  <rect y="100" width="200" height="25" fill="#f8a5d6"/>
  <ellipse cx="100" cy="100" rx="60" ry="5" fill="#fbc9e6"/>
</g>
<path d="M78 40h44v52l42 78c8 16-2 30-20 30H56c-18 0-28-14-20-30l42-78Z" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>
<rect x="70" y="28" width="60" height="14" rx="7" fill="#fff"/>
<path d="M88 60v30" stroke="#fff" stroke-opacity=".75" stroke-width="7" stroke-linecap="round"/>
<g fill="#fff">
  <path d="M160 34l4 10 10 4-10 4-4 10-4-10-10-4 10-4Z"/>
  <path d="M38 70l3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>
</g>
"""


def icon_svg(size: int, flask_scale: float) -> str:
    """Čtvercová ikona přes celou plochu (bez průhlednosti), baňka zmenšená na flask_scale."""
    s = flask_scale
    # Baňka má viewBox 200x220, vycentrujeme ji ve čtverci 200x200.
    tx = 100 - 100 * s
    ty = 100 - 118 * s
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 200 200">
{FLASK}
<rect width="200" height="200" fill="url(#bg)"/>
<rect width="200" height="200" fill="url(#glow)"/>
<g transform="translate({tx} {ty}) scale({s})">{BODY}</g>
</svg>"""


TARGETS = [
    ("icon-192.png", 192, 0.78),
    ("icon-512.png", 512, 0.78),
    ("icon-maskable-512.png", 512, 0.6),
    ("apple-touch-icon.png", 180, 0.74),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(device_scale_factor=1)
        for name, size, scale in TARGETS:
            page.set_viewport_size({"width": size, "height": size})
            page.set_content(
                f"<html><body style='margin:0;background:#000'>{icon_svg(size, scale)}</body></html>"
            )
            page.locator("svg").screenshot(path=str(OUT / name), omit_background=False)
            print("vytvořeno", OUT / name)
        browser.close()


if __name__ == "__main__":
    main()
