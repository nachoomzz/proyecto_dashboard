"""Servidor estàtic mínim (només biblioteca estàndard, sense instal·lar res).

   python server.py        ->  http://<IP-del-PC>:5000  des de qualsevol dispositiu de la wifi
"""
import socket
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST, PORT = "0.0.0.0", 5000
ARREL = Path(__file__).resolve().parent
DIRECTORI = ARREL / "web"

# Amb pythonw.exe (execució automàtica, sense finestra) no hi ha consola: stdout/stderr valen None
# i el servidor petaria en escriure el log. Aleshores ho enviem a servidor.log.
if sys.stdout is None or sys.stderr is None:
    ruta_log = ARREL / "servidor.log"
    mode = "w" if ruta_log.exists() and ruta_log.stat().st_size > 1_000_000 else "a"  # evita que creixi sense límit
    _log = open(ruta_log, mode, encoding="utf-8", buffering=1)
    sys.stdout = sys.stdout or _log
    sys.stderr = sys.stderr or _log


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # així els canvis es veuen de seguida
        super().end_headers()


def ip_local():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "IP-del-PC"


if __name__ == "__main__":
    print(f"Panell a http://{ip_local()}:{PORT}  (Ctrl+C per aturar)")
    ThreadingHTTPServer((HOST, PORT), partial(Handler, directory=str(DIRECTORI))).serve_forever()
