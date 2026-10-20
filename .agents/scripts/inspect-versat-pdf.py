import fitz

document = fitz.open("attached_assets/HAB26089_1792531763738.pdf")
page = document[0]
page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save("/tmp/versat-invoice-preview.png")
print(f"Pages: {len(document)}; rendered first page to /tmp/versat-invoice-preview.png")
