"""Converteix data/horaris_rubi.csv  ->  build/horaris.json

Cada columna del CSV passa a ser una "taula" d'horaris.
Qualsevol lletra enganxada a l'hora (p. ex. 07:24a) s'ignora.
Executa'l cada vegada que canviïs el CSV:   python tools/convertir_csv.py
"""
import csv
import json
import re
from pathlib import Path

def trobar_arrel():
    """Carpeta del projecte: la que conté 'data/' (o 'web/'), tant si l'script
    és a l'arrel com si és dins de 'tools/'."""
    aqui = Path(__file__).resolve().parent
    for cand in (aqui, aqui.parent):
        if (cand / "data").is_dir() or (cand / "web").is_dir():
            return cand
    raise SystemExit(
        f"No trobo les carpetes 'data' i 'web' al costat de {aqui}.\n"
        "Col·loca aquest fitxer a l'arrel del projecte o dins de 'tools/'."
    )


ARREL = trobar_arrel()
ENTRADA = ARREL / "data" / "horaris_rubi.csv"
SORTIDA = ARREL / "build" / "horaris.json"

PATRO = re.compile(r"^(\d{1,2}):(\d{2})[A-Za-z]*$")


def main():
    if not ENTRADA.exists():
        raise SystemExit(f"No trobo el CSV a {ENTRADA}\nCopia'l a la carpeta 'data' amb el nom {ENTRADA.name}.")
    taules = {}
    with open(ENTRADA, newline="", encoding="utf-8-sig") as f:
        lector = csv.reader(f, delimiter=";")
        capcalera = [c.strip() for c in next(lector)]
        for c in capcalera:
            taules[c] = []
        for num, fila in enumerate(lector, start=2):
            for c, valor in zip(capcalera, fila):
                valor = valor.strip()
                if not valor:
                    continue
                m = PATRO.match(valor)
                if not m:
                    print(f"AVÍS fila {num}, {c}: valor ignorat '{valor}'")
                    continue
                taules[c].append(f"{int(m.group(1)):02d}:{m.group(2)}")

    for c, llista in taules.items():
        llista.sort()
        print(f"{c:35} {len(llista):3} sortides")

    SORTIDA.parent.mkdir(parents=True, exist_ok=True)
    SORTIDA.write_text(json.dumps(taules, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"\nEscrit {SORTIDA}")


if __name__ == "__main__":
    main()
