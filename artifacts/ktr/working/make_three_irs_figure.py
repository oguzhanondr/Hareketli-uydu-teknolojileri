from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "artifacts" / "ktr" / "working" / "03a-harita-yerlesim.png"
OUTPUT = ROOT / "artifacts" / "ktr" / "working" / "03c-harita-uc-irs-yerlesim.png"

SCALE = 4
GREEN = "#16a36a"
GREEN_DARK = "#0e7d50"
WHITE = "#ffffff"


def point(x, y):
    return int(x * SCALE), int(y * SCALE)


def draw_line(draw, a, b, fill=GREEN, width=3):
    draw.line([point(*a), point(*b)], fill=fill, width=width * SCALE)


def draw_marker(draw, center, label):
    x, y = center
    cx, cy = point(x, y)
    radius = 17 * SCALE
    tail = 12 * SCALE

    draw.polygon(
        [
            (cx - int(radius * 0.72), cy + int(radius * 0.55)),
            (cx + int(radius * 0.72), cy + int(radius * 0.55)),
            (cx, cy + radius + tail),
        ],
        fill=GREEN_DARK,
        outline=WHITE,
    )
    draw.ellipse(
        (cx - radius, cy - radius, cx + radius, cy + radius),
        fill=GREEN,
        outline=WHITE,
        width=3 * SCALE,
    )
    inner = 9 * SCALE
    draw.ellipse(
        (cx - inner, cy - inner, cx + inner, cy + inner),
        fill=WHITE,
    )
    font = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 11 * SCALE)
    bbox = draw.textbbox((0, 0), str(label), font=font)
    draw.text(
        (cx - (bbox[2] - bbox[0]) / 2, cy - (bbox[3] - bbox[1]) / 2 - 1 * SCALE),
        str(label),
        font=font,
        fill=GREEN_DARK,
    )


base = Image.open(SOURCE).convert("RGB")
canvas = base.resize((base.width * SCALE, base.height * SCALE), Image.Resampling.LANCZOS)
draw = ImageDraw.Draw(canvas)

# Existing terminal and IRS-1 coordinates in the source screenshot.
terminal = (274, 245)
irs_1 = (350, 245)

# Two additional, deliberately separated IRS points close to the debris groups.
irs_2 = (515, 270)  # east of the main red debris footprint
irs_3 = (405, 400)  # south of the lower debris/survivor group

# Main terminal-to-IRS links.
draw_line(draw, terminal, irs_2, width=3)
draw_line(draw, terminal, irs_3, width=3)

# Clean IRS-to-target links; endpoints are chosen among visible survivor groups.
for target in [(468, 275), (493, 300), (455, 315)]:
    draw_line(draw, irs_2, target, width=2)

for target in [(376, 365), (390, 375), (414, 315)]:
    draw_line(draw, irs_3, target, width=2)

draw_marker(draw, irs_2, 2)
draw_marker(draw, irs_3, 3)

result = canvas.resize(base.size, Image.Resampling.LANCZOS)
result.save(OUTPUT)
print(OUTPUT)
