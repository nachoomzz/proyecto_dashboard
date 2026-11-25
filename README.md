# Panell de sortides de bus i tren (Rubí) — GitHub Pages amb dades xifrades

La pàgina és pública, però les dades (horaris, línies, lloc del temps) només es veuen amb una contrasenya.
Es xifren al teu PC (AES-256-GCM) i a GitHub només hi puja el fitxer xifrat.
La primera vegada que escrius la contrasenya en un dispositiu, el navegador se'n recorda.

```
├── data/horaris_rubi.csv        PRIVAT  els teus horaris
├── config/serveis.json          PRIVAT  línies, noms i colors
├── config/ajustos.json          PRIVAT  lloc del temps
├── build/                       PRIVAT  intermedis (es generen sols)
├── tools/                       convertir_csv.py, generar_festius.py, xifrar.py
├── web/                         PÚBLIC  index.html, app.js, style.css
│   └── data/dades.enc.json      PÚBLIC  l'únic fitxer de dades, xifrat
├── .github/workflows/pages.yml  publica web/ a cada push
└── .gitignore                   impedeix pujar el que és privat
```

## Actualitzar horaris
1. Edita `data/horaris_rubi.csv` (o `config/*.json`).
2. `python tools/xifrar.py` (et demana la contrasenya).
3. `git add .` · `git commit -m "Actualitzo horaris"` · `git push`

## Contrasenya
- Mínim 12 caràcters. Proposta aleatòria forta: `python tools/xifrar.py --genera`.
- Si la canvies, els dispositius la tornaran a demanar. Guarda-la en un gestor de contrasenyes.

## Provar en local
`python tools/xifrar.py`, després `python server.py` i obre http://localhost:5000
(el desxifrat només funciona amb https:// o localhost, no amb la IP de la xarxa local).

Requereix: `pip install cryptography`
