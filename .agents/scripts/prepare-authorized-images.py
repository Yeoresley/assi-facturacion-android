"""Extract only the owner's explicitly authorized scans from the reference."""
from pathlib import Path
import pymupdf

output = Path("generated-artifacts/authorized-images")
output.mkdir(parents=True, exist_ok=True)
doc = pymupdf.open("attached_assets/HAB26089_1792531763738.pdf")
doc[0].get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(output / "reference.png")
images = [b for b in doc[0].get_text("dict")["blocks"] if b["type"] == 1]
for name, top in [("stamp", 690), ("signature", 640)]:
    block = next(b for b in images if top < b["bbox"][1] < top + 10)
    pix = pymupdf.Pixmap(block["image"])
    pix.save(output / f"{name}.png")
