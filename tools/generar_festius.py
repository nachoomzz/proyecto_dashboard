"""Genera build/festius.json amb els festius separats per àmbit:

  general    -> Catalunya (afecta bus i tren)
  rubi       -> locals de Rubí (només bus)
  barcelona  -> locals de Barcelona (només tren)

Quins àmbits afecta cada servei es defineix a web/data/serveis.json ("festius").
REVISA el resultat amb els calendaris oficials de cada any.
Executa:   python tools/generar_festius.py
"""
import json
from datetime import date, timedelta
from pathlib import Path

ANYS = list(range(2026, 2032))   # 2026-2031

GENERALS_FIXOS = [
    ((1, 1), "Cap d'Any"),
    ((1, 6), "Reis"),
    ((5, 1), "Festa del Treball"),
    ((6, 24), "Sant Joan"),
    ((8, 15), "L'Assumpció"),
    ((9, 11), "Diada Nacional de Catalunya"),
    ((10, 12), "Festa Nacional d'Espanya"),
    ((11, 1), "Tots Sants"),
    ((12, 6), "Dia de la Constitució"),
    ((12, 8), "La Immaculada"),
    ((12, 25), "Nadal"),
    ((12, 26), "Sant Esteve"),
]

# Locals de Rubí (afecten el bus). Format: ("YYYY-MM-DD", "nom")
LOCALS_RUBI = []

# Locals de Barcelona (afecten el tren). La Mercè fix; el 2n Pasqua es calcula sota.
LOCALS_BARCELONA_FIXOS = [((9, 24), "La Mercè")]
# Dates concretes extra de Barcelona (p. ex. si La Mercè es trasllada)
LOCALS_BARCELONA_EXTRA = []


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


def pasqua(any_):
    """Diumenge de Pasqua (algorisme gregorià)."""
    a = any_ % 19
    b, c = divmod(any_, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes, dia = divmod(h + l - 7 * m + 114, 31)
    return date(any_, mes, dia + 1)


def llista(dict_):
    return [{"data": d, "nom": n} for d, n in sorted(dict_.items())]


def main():
    general, barcelona, rubi = {}, {}, {}
    for y in ANYS:
        for (m, d), nom in GENERALS_FIXOS:
            general[date(y, m, d).isoformat()] = nom
        p = pasqua(y)
        general[(p - timedelta(days=2)).isoformat()] = "Divendres Sant"
        general[(p + timedelta(days=1)).isoformat()] = "Dilluns de Pasqua"
        for (m, d), nom in LOCALS_BARCELONA_FIXOS:
            barcelona[date(y, m, d).isoformat()] = nom
        barcelona[(p + timedelta(days=50)).isoformat()] = "Dilluns de Pasqua Granada"
    for d, n in LOCALS_BARCELONA_EXTRA:
        barcelona[d] = n
    for d, n in LOCALS_RUBI:
        rubi[d] = n

    sortida = {"general": llista(general), "rubi": llista(rubi), "barcelona": llista(barcelona)}
    ruta = ARREL / "build" / "festius.json"
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(sortida, ensure_ascii=False, indent=1), encoding="utf-8")
    for ambit, items in sortida.items():
        print(f"\n[{ambit}]")
        for s in items:
            print(" ", s["data"], s["nom"])


if __name__ == "__main__":
    main()
