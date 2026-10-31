# Contact sheet: python3 scripts/contact-sheet.py out.png cols cellW cellH label1=path1 label2=path2 ...
import sys, os
from PIL import Image, ImageDraw, ImageFont
out, cols, cw, ch = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
items = [a.split('=', 1) for a in sys.argv[5:]]
rows = (len(items) + cols - 1) // cols
sheet = Image.new('RGB', (cols * cw, rows * (ch + 26)), '#f6efe8')
d = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
except Exception: font = ImageFont.load_default()
for i, (label, path) in enumerate(items):
    im = Image.open(path).convert('RGB')
    if os.environ.get('CROP'):
        a = [float(v) for v in os.environ['CROP'].split(',')]; W, H = im.size
        im = im.crop((int(a[0] * W), int(a[1] * H), int(a[2] * W), int(a[3] * H)))
    im.thumbnail((cw, ch))
    x, y = (i % cols) * cw, (i // cols) * (ch + 26)
    sheet.paste(im, (x + (cw - im.width) // 2, y + 26))
    d.text((x + 6, y + 5), label, fill='#4b3f5c', font=font)
sheet.save(out); print(out, sheet.size)
