// ---------- Configuració ----------

const REFRESC_MS = 30000;                  // cada quant es recalcula el panell
const RECARREGA_DADES_MS = 10 * 60 * 1000; // cada quant es tornen a baixar les dades xifrades
const REFRESC_TEMPS_MS = 15 * 60 * 1000;   // cada quant es demana la previsió del temps
const LLINDAR_PLUJA = 50;                  // % a partir del qual s'avisa de pluja probable
const AAD = "panell-v1";                   // ha de coincidir amb tools/xifrar.py
const CLAU_STORAGE = "panell_clau_v1";     // on es recorda la clau derivada en aquest dispositiu

// ---------- Xifrat (WebCrypto: AES-256-GCM + PBKDF2-SHA256) ----------

function deB64(s) {
  const b = atob(s);
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

function aB64(u) {
  let s = "";
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s);
}

// Deriva la clau AES a partir de la contrasenya (extraïble, per poder-la recordar al dispositiu)
async function derivaClau(contrasenya, meta) {
  const subtle = globalThis.crypto.subtle;
  const material = await subtle.importKey("raw", new TextEncoder().encode(contrasenya), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt: deB64(meta.sal), iterations: meta.iteracions, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, true, ["decrypt"]
  );
}

async function exportaClau(clau) {
  return aB64(new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", clau)));
}

async function importaClau(b64) {
  return globalThis.crypto.subtle.importKey("raw", deB64(b64), "AES-GCM", false, ["decrypt"]);
}

// Llança OperationError si la clau no és la correcta
async function desxifra(meta, clau) {
  const clar = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: deB64(meta.iv), additionalData: new TextEncoder().encode(AAD) },
    clau, deB64(meta.dades)
  );
  return JSON.parse(new TextDecoder().decode(clar));
}

function construeixDades(c) {
  const festius = {};
  for (const ambit of Object.keys(c.festius)) festius[ambit] = new Set(c.festius[ambit].map(x => x.data));
  return { taules: c.horaris, targetes: c.serveis.targetes, festius, config: c.config || {} };
}

// ---------- Lògica d'horaris (funciona al navegador i a Node per fer proves) ----------

function iso(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function mesDies(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// Uneix els festius dels àmbits que afecten aquesta font (p. ex. general + rubi per al bus)
function festiusDelServei(servei, festius) {
  const unio = new Set();
  for (const ambit of servei.festius || ["general"]) {
    for (const dia of festius[ambit] || []) unio.add(dia);
  }
  return unio;
}

function esFestiu(d, setFestius) {
  return d.getDay() === 0 || setFestius.has(iso(d));
}

// Tipus de dia: "festiu" | "dissabte" | "div_prefestiu" | "feiner"
function categoriaDia(d, setFestius) {
  if (esFestiu(d, setFestius)) return "festiu";       // diumenge o festiu (guanya sobre dissabte)
  if (d.getDay() === 6) return "dissabte";
  if (d.getDay() === 5 || esFestiu(mesDies(d, 1), setFestius)) return "div_prefestiu"; // divendres o vigília
  return "feiner";
}

// Properes `n` sortides d'UNA font (una línia), passant al dia següent si cal.
// Cada hora d'una taula és del dia natural d'aquella taula (00:07 a "dissabte" = nit de divendres a dissabte).
function proximes(font, taules, festius, ara, n) {
  const setFestius = festiusDelServei(font, festius);
  const res = [];
  for (let off = 0; off < 3 && res.length < n; off++) {
    const dia = mesDies(ara, off);
    const cat = categoriaDia(dia, setFestius);
    const taula = taules[font.taules[cat]] || [];
    for (const hm of taula) {
      const [h, m] = hm.split(":").map(Number);
      const quan = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), h, m);
      if (quan > ara) {
        res.push({ quan, hm, off, cat });
        if (res.length >= n) break;
      }
    }
  }
  return res;
}

// Properes sortides d'una TARGETA (pot ajuntar diverses línies, p. ex. L1 + L5), ordenades per hora.
//  - minuts_minims: s'amaguen les sortides que passen d'aquí a aquests minuts o menys (no es poden agafar)
//  - avis_fins: les que queden entre minuts_minims i aquest valor es marquen amb avis (parpellegen)
function proximesTargeta(targeta, taules, festius, ara) {
  const minim = targeta.minuts_minims || 0;
  const avisFins = targeta.avis_fins || 0;
  const extra = minim ? 8 : 0; // en demanem més, perquè n'amagarem algunes
  const tot = [];
  for (const font of targeta.fonts) {
    for (const p of proximes(font, taules, festius, ara, targeta.n + extra)) {
      const min = Math.floor((p.quan - ara) / 60000);
      if (minim && min <= minim) continue;
      tot.push({ ...p, min, avis: avisFins > 0 && min <= avisFins, linia: font.linia, color: font.color || null });
    }
  }
  tot.sort((a, b) => a.quan - b.quan);
  return tot.slice(0, targeta.n);
}

// ---------- Lògica del temps ----------

// Codis WMO (Open-Meteo) -> emoji
function iconaTemps(codi, esDia = true) {
  if (codi === 0) return esDia ? "☀️" : "🌙";
  if (codi === 1 || codi === 2) return esDia ? "🌤️" : "☁️";
  if (codi === 3) return "☁️";
  if (codi === 45 || codi === 48) return "🌫️";
  if (codi >= 51 && codi <= 57) return "🌦️";
  if (codi >= 61 && codi <= 67) return "🌧️";
  if (codi >= 71 && codi <= 77) return "🌨️";
  if (codi >= 80 && codi <= 82) return "🌧️";
  if (codi === 85 || codi === 86) return "🌨️";
  if (codi >= 95) return "⛈️";
  return "🌡️";
}

// Resum de la resposta d'Open-Meteo: temperatura actual, màx/mín i pluja del que queda de dia
function resumTemps(api) {
  const c = api.current, h = api.hourly, d = api.daily;
  const avui = c.time.slice(0, 10);
  const horaAra = parseInt(c.time.slice(11, 13), 10);
  let probMax = 0, horaProbMax = null, primeraPluja = null;
  for (let i = 0; i < h.time.length; i++) {
    if (!h.time[i].startsWith(avui)) continue;
    const hora = parseInt(h.time[i].slice(11, 13), 10);
    if (hora < horaAra) continue;
    const p = h.precipitation_probability[i] ?? 0;
    if (p > probMax) { probMax = p; horaProbMax = hora; }
    if (primeraPluja === null && p >= LLINDAR_PLUJA) primeraPluja = hora;
  }
  return {
    temp: Math.round(c.temperature_2m),
    icona: iconaTemps(c.weather_code, horaAra >= 7 && horaAra < 21),
    max: Math.round(d.temperature_2m_max[0]),
    min: Math.round(d.temperature_2m_min[0]),
    mm: d.precipitation_sum[0] ?? 0,
    probMax, horaProbMax, primeraPluja,
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    categoriaDia, proximes, proximesTargeta, festiusDelServei, iso, resumTemps, iconaTemps,
    derivaClau, exportaClau, importaClau, desxifra, construeixDades,
  };
}

// ---------- Interfície (només navegador) ----------
if (typeof document !== "undefined") {
  const $ = id => document.getElementById(id);
  const NOMS_CAT = {
    feiner: "feiner", div_prefestiu: "divendres/vigília de festiu",
    dissabte: "dissabte", festiu: "diumenge/festiu",
  };
  let dades = null;      // dades desxifrades (horaris, targetes, festius, config)
  let clauActual = null; // clau de desxifrat en memòria
  let temps = null;

  // --- Clau recordada al dispositiu (la clau derivada, no la contrasenya) ---
  function llegeixClauGuardada() { try { return localStorage.getItem(CLAU_STORAGE); } catch (e) { return null; } }
  function guardaClau(b64) { try { localStorage.setItem(CLAU_STORAGE, b64); } catch (e) { /* mode privat */ } }
  function esborraClau() { try { localStorage.removeItem(CLAU_STORAGE); } catch (e) { /* res */ } }

  async function baixaMeta() {
    const r = await fetch("data/dades.enc.json", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  function mostraBloqueig(missatge) {
    $("contingut").hidden = true;
    $("bloqueig").hidden = false;
    $("error-clau").textContent = missatge || "";
    $("clau").focus();
  }

  async function aplica(meta, clau) {
    const c = await desxifra(meta, clau); // llança si la clau és incorrecta
    clauActual = clau;
    dades = construeixDades(c);
    $("bloqueig").hidden = true;
    $("contingut").hidden = false;
    pinta();
    carregaTemps();
  }

  async function iniciar() {
    if (!(globalThis.crypto && globalThis.crypto.subtle)) {
      mostraBloqueig("Aquest navegador només pot desxifrar des d'una adreça https:// (o localhost).");
      $("entra").disabled = true;
      return;
    }
    const guardada = llegeixClauGuardada();
    if (guardada) {
      try {
        await aplica(await baixaMeta(), await importaClau(guardada));
        return;
      } catch (e) {
        if (e && e.name === "OperationError") esborraClau();       // la contrasenya ha canviat
        else if (!(e instanceof SyntaxError)) { mostraBloqueig("No s'han pogut carregar les dades."); return; }
      }
    }
    mostraBloqueig("");
  }

  $("form-clau").addEventListener("submit", async ev => {
    ev.preventDefault();
    $("entra").disabled = true;
    $("error-clau").textContent = "Comprovant…";
    try {
      const meta = await baixaMeta();
      const clau = await derivaClau($("clau").value, meta);
      await aplica(meta, clau);
      guardaClau(await exportaClau(clau));
      $("clau").value = "";
      $("error-clau").textContent = "";
    } catch (e) {
      $("error-clau").textContent =
        e && e.name === "OperationError" ? "Contrasenya incorrecta." : "No s'han pogut carregar les dades.";
    } finally {
      $("entra").disabled = false;
    }
  });

  $("mostra").addEventListener("click", () => {
    const c = $("clau");
    c.type = c.type === "password" ? "text" : "password";
  });

  $("oblida").addEventListener("click", () => {
    esborraClau();
    location.reload();
  });

  async function recarregaDades() {
    if (!clauActual) return;
    try {
      dades = construeixDades(await desxifra(await baixaMeta(), clauActual));
    } catch (e) {
      if (e && e.name === "OperationError") {      // s'ha canviat la contrasenya
        esborraClau();
        clauActual = null; dades = null; temps = null;
        $("temps").innerHTML = "";
        mostraBloqueig("Les dades s'han actualitzat amb una contrasenya nova.");
      }
    }
  }

  // --- Temps ---
  async function carregaTemps() {
    const lloc = dades && dades.config && dades.config.temps;
    if (!lloc) return;
    const url = "https://api.open-meteo.com/v1/forecast"
      + `?latitude=${lloc.lat}&longitude=${lloc.lon}`
      + "&current=temperature_2m,weather_code"
      + "&hourly=precipitation_probability"
      + "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum"
      + "&timezone=Europe%2FMadrid&forecast_days=1";
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      temps = resumTemps(await r.json());
    } catch (e) {
      // Sense internet o error del servei: es manté l'última previsió (o res)
    }
    pintaTemps();
  }

  function pintaTemps() {
    const el = $("temps");
    const lloc = dades && dades.config && dades.config.temps;
    if (!temps || !lloc) { el.innerHTML = ""; return; }
    const t = temps;
    let pluja;
    if (t.primeraPluja !== null) {
      pluja = `<span class="xip pluja">☔ Pluja probable des de les ${t.primeraPluja} h (${t.probMax}%)${t.mm >= 0.5 ? ` · ${t.mm.toFixed(1)} mm` : ""}</span>`;
    } else if (t.probMax >= 30) {
      pluja = `<span class="xip">🌦️ Possible pluja: ${t.probMax}% a les ${t.horaProbMax} h</span>`;
    } else {
      pluja = `<span class="xip sec">Sense pluja prevista</span>`;
    }
    el.innerHTML = `<span class="xip">${t.icona} ${t.temp}° · ${lloc.nom}</span>
                    <span class="xip sec">Màx ${t.max}° / Mín ${t.min}°</span>${pluja}`;
  }

  // --- Targetes ---
  function textMinuts(min) {
    if (min < 1) return "ara";
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
  }

  function etiquetaDia(off, quan) {
    if (off === 0) return "";
    if (off === 1) return "demà";
    return `${quan.getDate()}/${quan.getMonth() + 1}`;
  }

  function htmlTargeta(t, ara) {
    const llista = proximesTargeta(t, dades.taules, dades.festius, ara);
    const ambBadge = t.fonts.length > 1; // només es mostra la línia si la targeta n'agrupa diverses
    const files = llista.length
      ? llista.map(p => {
          const badge = ambBadge ? `<span class="badge" style="background:${p.color}">${p.linia}</span>` : "";
          const classes = [ambBadge ? "amb-badge" : "", p.avis ? "avis" : ""].join(" ").trim();
          return `<li class="${classes}">${badge}
                    <span class="hora">${p.hm}</span>
                    <span class="dia">${etiquetaDia(p.off, p.quan)}</span>
                    <span class="minuts ${p.min <= 5 ? "urgent" : ""}">${textMinuts(p.min)}</span>
                  </li>`;
        }).join("")
      : `<li class="buit">Sense sortides properes</li>`;
    return `<div class="targeta">
              <h3 style="background:${t.color};color:${t.text}">${t.nom}</h3>
              <ul>${files}</ul>
            </div>`;
  }

  // Resum "avui/demà" per tipus (bus i tren poden tenir festius diferents)
  function resumDies(ara) {
    const parts = [];
    for (const tipus of ["bus", "tren"]) {
      const t = dades.targetes.find(x => x.tipus === tipus);
      if (!t) continue;
      const set = festiusDelServei(t.fonts[0], dades.festius);
      parts.push(`${tipus === "bus" ? "Bus" : "Tren"}: avui ${NOMS_CAT[categoriaDia(ara, set)]}, demà ${NOMS_CAT[categoriaDia(mesDies(ara, 1), set)]}`);
    }
    return parts.join(" · ");
  }

  function pintaRellotge() {
    const ara = new Date();
    $("rellotge").textContent = ara.toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" });
    $("data").textContent = ara.toLocaleDateString("ca-ES", { weekday: "long", day: "numeric", month: "long" });
  }

  function pinta() {
    if (!dades) return;
    const ara = new Date();
    for (const tipus of ["bus", "tren"]) {
      $(tipus).innerHTML = dades.targetes.filter(t => t.tipus === tipus).map(t => htmlTargeta(t, ara)).join("");
    }
    const tren = dades.targetes.find(t => t.tipus === "tren" && t.minuts_minims);
    $("nota-tren").textContent = tren ? `· s'amaguen els trens a ${tren.minuts_minims} min o menys` : "";
    $("estat").textContent =
      `${resumDies(ara)} · Actualitzat ${ara.toLocaleTimeString("ca-ES")} · Temps: Open-Meteo.com`;
  }

  pintaRellotge();
  setInterval(pintaRellotge, 1000);
  setInterval(pinta, REFRESC_MS);
  setInterval(recarregaDades, RECARREGA_DADES_MS);
  setInterval(carregaTemps, REFRESC_TEMPS_MS);
  iniciar();
}
