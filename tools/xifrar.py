"""Xifra les dades del panell i genera web/data/dades.enc.json,
l'ÚNIC fitxer de dades que es publica a GitHub Pages.

  python tools/xifrar.py              -> llegeix el CSV, genera festius, xifra i escriu el fitxer
  python tools/xifrar.py --genera     -> només proposa una contrasenya aleatòria forta
  python tools/xifrar.py --nova-sal   -> força una sal nova (els dispositius tornaran a demanar la contrasenya)

Xifrat: AES-256-GCM amb clau derivada de la contrasenya amb PBKDF2-SHA256 (600.000 iteracions).
Requereix:  pip install cryptography
"""
import argparse
import base64
import contextlib
import getpass
import hashlib
import io
import json
import os
import secrets
import sys

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    sys.exit("Falta la llibreria 'cryptography'. Instal·la-la amb:  pip install cryptography")

import convertir_csv
import generar_festius

ITERACIONS = 600_000
AAD = b"panell-v1"                        # ha de coincidir amb app.js
MIN_LONGITUD = 12
ALFABET = "abcdefghjkmnpqrstuvwxyz23456789"   # sense lletres confuses (i, l, o, 0, 1)


def b64(x):
    return base64.b64encode(x).decode()


def deriva(clau, sal, iteracions):
    return hashlib.pbkdf2_hmac("sha256", clau.encode("utf-8"), sal, iteracions, dklen=32)


def desxifra(meta, clau):
    k = deriva(clau, base64.b64decode(meta["sal"]), meta["iteracions"])
    return AESGCM(k).decrypt(base64.b64decode(meta["iv"]), base64.b64decode(meta["dades"]), AAD)


def genera_contrasenya():
    grups = ["".join(secrets.choice(ALFABET) for _ in range(4)) for _ in range(5)]
    return "-".join(grups)  # 20 caràcters, uns 99 bits d'entropia


def llegeix_json(ruta, que):
    if not ruta.exists():
        sys.exit(f"Falta {ruta}  ({que})")
    return json.loads(ruta.read_text(encoding="utf-8"))


def comprova_serveis(serveis, horaris):
    """Avisa si serveis.json fa servir una columna que no existeix al CSV (o és buida)."""
    problemes = 0
    for t in serveis["targetes"]:
        for f in t["fonts"]:
            for tipus_dia, taula in f["taules"].items():
                if taula not in horaris:
                    print(f"  AVÍS: {t['nom']} / {f['linia']} / {tipus_dia}: la columna '{taula}' no existeix al CSV")
                    problemes += 1
                elif not horaris[taula]:
                    print(f"  AVÍS: la columna '{taula}' està buida")
                    problemes += 1
    return problemes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--genera", action="store_true")
    ap.add_argument("--nova-sal", action="store_true")
    a = ap.parse_args()

    if a.genera:
        print("Contrasenya proposada (guarda-la en un gestor de contrasenyes):\n")
        print("   ", genera_contrasenya())
        return

    arrel = convertir_csv.ARREL
    print("1/3 Llegint el CSV...")
    convertir_csv.main()
    print("2/3 Generant festius...")
    with contextlib.redirect_stdout(io.StringIO()):
        generar_festius.main()

    horaris = llegeix_json(arrel / "build" / "horaris.json", "executa convertir_csv.py")
    festius = llegeix_json(arrel / "build" / "festius.json", "executa generar_festius.py")
    serveis = llegeix_json(arrel / "config" / "serveis.json", "configuració de línies")
    config = llegeix_json(arrel / "config" / "ajustos.json", "ajustos (lloc del temps)")
    config.pop("_comentari", None)
    serveis.pop("_comentari", None)
    comprova_serveis(serveis, horaris)

    clar = json.dumps(
        {"horaris": horaris, "serveis": serveis, "festius": festius, "config": config},
        ensure_ascii=False, separators=(",", ":"),
    ).encode("utf-8")

    print("3/3 Xifrant...")
    sortida = arrel / "web" / "data" / "dades.enc.json"
    antiga = None
    if sortida.exists():
        try:
            antiga = json.loads(sortida.read_text(encoding="utf-8"))
        except ValueError:
            antiga = None

    automatic = bool(os.environ.get("PANELL_CLAU"))
    clau = os.environ.get("PANELL_CLAU") or getpass.getpass("Contrasenya del panell: ")
    if len(clau) < MIN_LONGITUD:
        sys.exit(f"Massa curta: mínim {MIN_LONGITUD} caràcters. El fitxer xifrat és públic i qualsevol pot "
                 "provar contrasenyes sense límit. Usa:  python tools/xifrar.py --genera")

    mateixa = False
    if antiga:
        try:
            desxifra(antiga, clau)
            mateixa = True
        except Exception:
            print("\nATENCIÓ: aquesta contrasenya NO és la de l'última versió publicada.\n"
                  "Si continues, tots els dispositius la tornaran a demanar.")
    if not mateixa and not automatic:
        if getpass.getpass("Repeteix la contrasenya: ") != clau:
            sys.exit("No coincideixen. No s'ha escrit res.")

    if antiga and mateixa and not a.nova_sal and antiga.get("iteracions") == ITERACIONS:
        sal = base64.b64decode(antiga["sal"])   # mateixa sal: els dispositius no han de tornar a posar la contrasenya
    else:
        sal = secrets.token_bytes(16)
    iv = secrets.token_bytes(12)                # IV nou a cada xifrat
    ct = AESGCM(deriva(clau, sal, ITERACIONS)).encrypt(iv, clar, AAD)

    meta = {"v": 1, "kdf": "PBKDF2-SHA256", "iteracions": ITERACIONS,
            "sal": b64(sal), "iv": b64(iv), "dades": b64(ct)}
    assert desxifra(meta, clau) == clar          # comprovació d'anada i tornada
    sortida.parent.mkdir(parents=True, exist_ok=True)
    sortida.write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
    print(f"\nFet: {sortida}  ({sortida.stat().st_size / 1024:.1f} KB)")
    print("Següent pas:  git add web/data/dades.enc.json  ·  git commit  ·  git push")


if __name__ == "__main__":
    main()
