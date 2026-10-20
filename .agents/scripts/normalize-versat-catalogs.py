"""Normalize the supplied workbooks without publishing source data into the web bundle."""
from pathlib import Path
from openpyxl import load_workbook
import json

ROOT = Path("attached_assets")


def table(name):
    matches = list(ROOT.glob(f"*_{name}_*.xlsx"))
    if len(matches) != 1:
        raise ValueError(f"Expected one workbook for {name}, got {len(matches)}")
    sheet = load_workbook(matches[0], read_only=True, data_only=True).active
    rows = iter(sheet.values)
    headers = next(rows)
    return [dict(zip(headers, row)) for row in rows if any(v is not None for v in row)]


def text(value):
    return None if value is None else str(value).strip()


units = {row["idmedida"]: row for row in table("gen_medida")}
entries = []
for row in units.values():
    entries.append(dict(kind="unit", sourceId=row["idmedida"], code=text(row["clave"]),
                        name=text(row["descripcion"]), exportValue=text(row["clave"]), metadata={}))
known_groups = {f"4651.2.03.{n:02}": "4651" for n in [5, 6, 7, 8, 9, 10, 11, 16, 17]}
for row in table("Fac_CodServicios"):
    unit = units[row["idMedida"]]
    metadata = dict(unitCode=text(unit["clave"]), unitName=text(unit["descripcion"]))
    if row["codigo"] in known_groups:
        metadata["groupCode"] = known_groups[row["codigo"]]
    entries.append(dict(kind="service", sourceId=row["idservicio"], code=text(row["codigo"]),
                        name=text(row["Descripcion"]), exportValue=text(row["codigo"]), metadata=metadata))
for row in table("gen_moneda"):
    entries.append(dict(kind="currency", sourceId=row["idmoneda"], code=text(row["sigla"]),
                        name=text(row["nombre"]), exportValue=str(row["nombre"]), metadata={}))
for row in table("fac_conceptoventa"):
    entries.append(dict(kind="concept", sourceId=row["idconcepto"], code=text(row["codigo"]),
                        name=text(row["descripcion"]), exportValue=text(row["codigo"]), metadata={}))
for row in table("fac_codoperacion"):
    entries.append(dict(kind="operation", sourceId=row["idoperacion"], code=str(row["idoperacion"]),
                        name=text(row["descripcion"]), exportValue=str(row["descripcion"]), metadata={}))
for row in table("Fac_Comercial"):
    # Personal identity document numbers are unnecessary for this integration.
    entries.append(dict(kind="commercial", sourceId=row["idcomercial"], code=str(row["idcomercial"]),
                        name=text(row["nombre"]), exportValue=str(row["nombre"]),
                        metadata=dict(position=text(row["cargo"]) or "")))
for row in table("Fac_FormaPago"):
    entries.append(dict(kind="payment", sourceId=row["idformapago"], code=str(row["idformapago"]),
                        name=text(row["Forma"]), exportValue=str(row["Forma"]), metadata={}))
customers = []
for row in table("gen_entidad"):
    customers.append(dict(name=text(row["nombre"]), versatCode=text(row["codigo"]),
                          versatSourceId=row["identidad"], ircc=text(row["IRCC"]),
                          taxId=text(row["NIT"]), address=text(row["direccion"]),
                          email=text(row["email"]), phone=text(row["telefono"]),
                          active=str(row["activo"]).strip() == "1"))
if len({c["versatCode"] for c in customers}) != len(customers):
    raise ValueError("Duplicate entity codes in source workbook")
Path("/tmp/versat-catalog-import.json").write_text(
    json.dumps(dict(entries=entries, customers=customers), ensure_ascii=False), encoding="utf-8")
print(f"Normalized {len(customers)} entities and {len(entries)} catalog entries.")
