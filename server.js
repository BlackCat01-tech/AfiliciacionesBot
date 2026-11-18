// server.js — Afiliaciones ARL Sura y Comfama: bot conversacional + API + panel (Postgres)
// Node 18+. Canales: Telegram y WhatsApp (Twilio o Meta Cloud API).
const express = require("express"), crypto = require("crypto"), path = require("path"), pg = require("pg");
const { PORT = 3000, DATABASE_URL, PANEL_PASSWORD, PERMITIDOS = "", BASE_URL = `http://localhost:${PORT}`,
  TELEGRAM_TOKEN, TELEGRAM_SECRET, TWILIO_AUTH_TOKEN, WA_VERIFY_TOKEN, WA_TOKEN, WA_PHONE_ID, APP_SECRET,
  GRAPH_VERSION = "v21.0" } = process.env;
if (!DATABASE_URL || !PANEL_PASSWORD) { console.error("Faltan DATABASE_URL o PANEL_PASSWORD."); process.exit(1); }

pg.types.setTypeParser(20, Number); // bigint -> número
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
process.on("unhandledRejection", (e) => console.error("Error no controlado:", e));
const permitidos = PERMITIDOS.split(",").map((s) => s.trim()).filter(Boolean);
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const xml = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const hoy = () => new Date().toISOString().slice(0, 10);

const app = express();
app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { req.raw = buf; } }));
app.use(express.urlencoded({ extended: false }));

// Los webhooks son públicos (cada uno se valida con su secreto); el panel y la API piden clave.
const publicas = ["/telegram", "/twilio", "/whatsapp"];
app.use((req, res, next) => {
  if (publicas.includes(req.path)) return next();
  const dec = Buffer.from((req.get("authorization") || "").split(" ")[1] || "", "base64").toString();
  const pass = dec.slice(dec.indexOf(":") + 1);
  if (crypto.timingSafeEqual(sha(pass), sha(PANEL_PASSWORD))) return next();
  res.set("WWW-Authenticate", 'Basic realm="Afiliaciones"').sendStatus(401);
});
app.use(express.static(path.join(__dirname, "public")));

// ---------- API del panel ----------
app.get("/api/afiliaciones", async (_q, r) => {
  const { rows } = await pool.query("select data from afiliaciones order by id desc");
  r.json(rows.map((x) => x.data));
});
app.put("/api/afiliaciones/:id", async (q, r) => {
  const id = Number(q.params.id), b = q.body;
  if (!Number.isSafeInteger(id) || !b || typeof b !== "object" || Number(b.id) !== id) return r.status(400).json({ error: "Datos inválidos" });
  await pool.query("insert into afiliaciones(id,data) values($1,$2) on conflict (id) do update set data=$2, updated_at=now()", [id, JSON.stringify(b)]);
  r.json({ ok: true });
});
app.delete("/api/afiliaciones/:id", async (q, r) => {
  await pool.query("delete from afiliaciones where id=$1", [Number(q.params.id)]);
  r.json({ ok: true });
});

// ---------- Motor de conversación (independiente del canal) ----------
const DOCS = ["CC", "CE", "TI", "PPT", "PA"], DOCB = [...DOCS, "RC"];
const RISK = ["I – Mínimo", "II – Bajo", "III – Medio", "IV – Alto", "V – Máximo"];
const CONT = ["Indefinido", "Fijo", "Obra o labor", "Aprendizaje"];
const PAR = ["Cónyuge o compañero(a)", "Hijo(a)", "Otro"];
const lista = (a) => a.map((x, i) => `${i + 1} = ${x}`).join("\n");
const opcion = (a) => (v) => { const n = +v; return n >= 1 && n <= a.length ? a[n - 1] : a.find((x) => x.toLowerCase() === v.toLowerCase()) || null; };
const txt = (v) => (v.length >= 2 && v.length <= 120 ? v : null);
function fecha(v) {
  let a, y, m, d;
  if ((a = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, m, d] = a;
  else if ((a = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/))) [, d, m, y] = a;
  else return null;
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  if (dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const PASOS = [
  { k: "tipo", l: "Tipo de documento", q: "Tipo de documento: CC, CE, TI, PPT o PA", p: (v) => (DOCS.includes(v.toUpperCase()) ? v.toUpperCase() : null) },
  { k: "num", l: "Documento", q: "Número de documento (solo dígitos)", p: (v) => (/^\d{5,12}$/.test(v) ? v : null) },
  { k: "nombres", l: "Nombres", q: "Nombres del trabajador", p: txt },
  { k: "apellidos", l: "Apellidos", q: "Apellidos del trabajador", p: txt },
  { k: "nac", l: "Fecha de nacimiento", q: "Fecha de nacimiento (AAAA-MM-DD o DD/MM/AAAA)", p: (v) => { const f = fecha(v); return f && f < hoy() ? f : null; } },
  { k: "sexo", l: "Sexo", q: "Sexo: F o M", p: (v) => ({ f: "Femenino", m: "Masculino" })[v.toLowerCase()[0]] || null },
  { k: "dir", l: "Dirección", q: "Dirección de residencia", p: txt },
  { k: "tel", l: "Teléfono", q: "Teléfono (7 a 10 dígitos)", p: (v) => (/^\d{7,10}$/.test(v.replace(/\s/g, "")) ? v.replace(/\s/g, "") : null) },
  { k: "mail", l: "Correo", q: "Correo electrónico", p: (v) => (/^\S+@\S+\.\S+$/.test(v) ? v : null) },
  { k: "cargo", l: "Cargo", q: "Cargo", p: txt },
  { k: "sal", l: "Salario", q: "Salario mensual (solo números)", p: (v) => { const n = +v.replace(/[.,\s$]/g, ""); return n > 0 ? n : null; } },
  { k: "ing", l: "Fecha de ingreso", q: "Fecha de ingreso (AAAA-MM-DD o DD/MM/AAAA)", p: fecha },
  { k: "contrato", l: "Contrato", q: "Tipo de contrato:\n" + lista(CONT), p: opcion(CONT) },
  { k: "riesgo", l: "Clase de riesgo", q: "Clase de riesgo del cargo:\n" + lista(RISK), p: opcion(RISK) },
  { k: "centro", l: "Centro de trabajo", q: "Centro de trabajo", p: txt },
  { k: "eps", l: "EPS", q: "EPS del trabajador", p: txt },
  { k: "afp", l: "Fondo de pensión", q: "Fondo de pensión", p: txt },
  { k: "ced", l: "Cédula", q: "Envía una foto de la cédula (o escribe OMITIR)", p: (v, media) => media || (/^omitir$/i.test(v) ? "" : null) },
];
const BEN = [
  { k: "n", l: "Nombre", q: "Nombre completo del beneficiario", p: txt },
  { k: "t", l: "Tipo de documento", q: "Tipo de documento del beneficiario: RC, TI, CC, CE, PPT o PA", p: (v) => (DOCB.includes(v.toUpperCase()) ? v.toUpperCase() : null) },
  { k: "d", l: "Documento", q: "Número de documento del beneficiario", p: (v) => (/^\d{5,12}$/.test(v) ? v : null) },
  { k: "f", l: "Nacimiento", q: "Fecha de nacimiento del beneficiario", p: (v) => { const f = fecha(v); return f && f <= hoy() ? f : null; } },
  { k: "p", l: "Parentesco", q: "Parentesco:\n" + lista(PAR), p: opcion(PAR) },
];
const ask = (s, i, n) => `(${i + 1}/${n}) ${s.q}`;
const AYUDA = "Comandos: AFILIAR (empezar), ATRAS (corregir la respuesta anterior), CANCELAR (descartar), ID (ver tu identificador).";

function resumen(e) {
  const d = e.d, l = [`${d.nombres} ${d.apellidos} · ${d.tipo} ${d.num}`, `Nacimiento: ${d.nac} · Sexo: ${d.sexo}`, `${d.dir} · Tel ${d.tel} · ${d.mail}`,
    `Cargo: ${d.cargo} · Salario: $${Number(d.sal).toLocaleString("es-CO")}`, `Ingreso: ${d.ing} · Contrato: ${d.contrato}`,
    `Riesgo: ${d.riesgo} · Centro: ${d.centro}`, `EPS: ${d.eps} · Pensión: ${d.afp}`, `Cédula: ${d.ced ? "recibida" : "pendiente"}`];
  e.ben.forEach((b, i) => l.push(`Beneficiario ${i + 1}: ${b.n} (${b.p}) · ${b.t} ${b.d} · ${b.f}`));
  return l.join("\n");
}

async function conversar(canal, chatId, texto, media, msgId) {
  const id = String(chatId), t = (texto || "").trim(), T = t.toLowerCase();
  if (/^\/?id$/.test(T)) return `Tu ID es ${id}`;
  if (permitidos.length && !permitidos.includes(id)) return `No estás autorizado para usar este asistente. Tu ID es ${id}; pídele al administrador que lo agregue.`;
  const row = (await pool.query("select estado from conversaciones where canal=$1 and chat_id=$2", [canal, id])).rows[0];
  let e = row ? row.estado : null;
  if (e && msgId && (e.vistos || []).includes(msgId)) return null; // mensaje repetido (reintento del canal)
  const guardar = async () => {
    if (!e) return pool.query("delete from conversaciones where canal=$1 and chat_id=$2", [canal, id]);
    if (msgId) e.vistos = [...(e.vistos || []).slice(-19), msgId];
    return pool.query("insert into conversaciones(canal,chat_id,estado) values($1,$2,$3) on conflict (canal,chat_id) do update set estado=$3, updated_at=now()", [canal, id, JSON.stringify(e)]);
  };
  const fin = async (r) => { await guardar(); return r; };
  const nuevo = () => ({ fase: "datos", i: 0, d: {}, ben: [], b: {}, bi: 0 });

  if (T === "cancelar") { e = null; return fin("Proceso cancelado. Escribe AFILIAR para empezar de nuevo."); }
  if (T === "ayuda" || T === "/help") return AYUDA;
  if (!e) {
    if (/^(afiliar|\/afiliar|\/start|nuevo|hola)/.test(T)) { e = nuevo(); return fin(`Vamos a registrar una afiliación (ARL Sura y Comfama). Te pediré los datos uno por uno. ${AYUDA}\n\n${ask(PASOS[0], 0, PASOS.length)}`); }
    return "Hola. Escribe AFILIAR para registrar un trabajador.";
  }
  if (T === "atras") {
    if (e.fase === "datos") { if (e.i === 0) return "Estás en la primera pregunta."; e.i--; return fin(`↩ ${ask(PASOS[e.i], e.i, PASOS.length)}`); }
    if (e.fase === "ben") { if (e.bi > 0) { e.bi--; return fin(`↩ ${ask(BEN[e.bi], e.bi, BEN.length)}`); } e.fase = "ben_pregunta"; return fin("¿Tiene cónyuge o hijos para afiliar a Comfama? Responde SI o NO"); }
    e.fase = "datos"; e.i = PASOS.length - 1; e.ben = []; return fin(`↩ ${ask(PASOS[e.i], e.i, PASOS.length)}`);
  }

  if (e.fase === "datos") {
    const s = PASOS[e.i], v = s.p(t, media);
    if (v === null) return `⚠ Dato no válido.\n\n${ask(s, e.i, PASOS.length)}`;
    e.d[s.k] = v; e.i++;
    const ok = `✔ ${s.l}: ${v === "" ? "pendiente" : s.k === "ced" ? "recibida" : v}`;
    if (e.i < PASOS.length) return fin(`${ok}\n\n${ask(PASOS[e.i], e.i, PASOS.length)}`);
    e.fase = "ben_pregunta";
    return fin(`${ok}\n\n¿Tiene cónyuge o hijos para afiliar a Comfama? Responde SI o NO`);
  }
  if (e.fase === "ben_pregunta" || e.fase === "ben_otro") {
    if (/^(si|sí|s)$/.test(T)) { e.fase = "ben"; e.bi = 0; e.b = {}; return fin(ask(BEN[0], 0, BEN.length)); }
    if (/^(no|n)$/.test(T)) { e.fase = "resumen"; return fin(`Este es el resumen:\n\n${resumen(e)}\n\nResponde CONFIRMAR para guardar, ATRAS para corregir o CANCELAR.`); }
    return "Responde SI o NO.";
  }
  if (e.fase === "ben") {
    const s = BEN[e.bi], v = s.p(t);
    if (v === null) return `⚠ Dato no válido.\n\n${ask(s, e.bi, BEN.length)}`;
    e.b[s.k] = v; e.bi++;
    if (e.bi < BEN.length) return fin(`✔ ${s.l}: ${v}\n\n${ask(BEN[e.bi], e.bi, BEN.length)}`);
    e.ben.push(e.b); e.b = {}; e.fase = "ben_otro";
    return fin(`✔ Beneficiario registrado: ${e.ben[e.ben.length - 1].n}\n\n¿Otro beneficiario? Responde SI o NO`);
  }
  if (e.fase === "resumen") {
    if (T !== "confirmar") return "Responde CONFIRMAR para guardar, ATRAS para corregir o CANCELAR.";
    const rec = { tipo: "CC", num: "", nombres: "", apellidos: "", nac: "", sexo: "", dir: "", tel: "", mail: "", cargo: "", sal: "", ing: "", contrato: "Indefinido", riesgo: "", centro: "", eps: "", afp: "", ced: "",
      ...e.d, ben: e.ben, arl: "Pendiente", caja: "Pendiente", motivo: "",
      log: [new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" }) + ` · Registrada por ${canal} (${id})`],
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000) };
    await pool.query("insert into afiliaciones(id,data) values($1,$2)", [rec.id, JSON.stringify(rec)]);
    const nom = `${rec.nombres} ${rec.apellidos}`; e = null;
    return fin(`✅ Afiliación registrada: ${nom}. Quedó pendiente en el panel para ARL Sura y Comfama. Escribe AFILIAR para registrar otra.`);
  }
}

// ---------- Canal: Telegram ----------
const tg = (chat, text) => fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text }) });
app.post("/telegram", async (req, res) => {
  if (!TELEGRAM_SECRET || req.get("x-telegram-bot-api-secret-token") !== TELEGRAM_SECRET) return res.sendStatus(403);
  res.sendStatus(200);
  try {
    const m = req.body.message; if (!m) return;
    const f = m.photo ? m.photo[m.photo.length - 1].file_id : m.document && m.document.file_id;
    const r = await conversar("telegram", m.chat.id, m.text || "", f ? "telegram:" + f : "", "u" + req.body.update_id);
    if (r) await tg(m.chat.id, r);
  } catch (e) { console.error("Telegram:", e); }
});

// ---------- Canal: WhatsApp con Twilio (responde con TwiML) ----------
app.post("/twilio", async (req, res) => {
  const b = req.body, data = BASE_URL + "/twilio" + Object.keys(b).sort().map((k) => k + b[k]).join("");
  const exp = crypto.createHmac("sha1", TWILIO_AUTH_TOKEN || "").update(data).digest("base64"), sig = req.get("x-twilio-signature") || "";
  if (!TWILIO_AUTH_TOKEN || sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return res.sendStatus(403);
  try {
    const r = await conversar("whatsapp", (b.From || "").replace(/\D/g, ""), b.Body || "", Number(b.NumMedia) > 0 ? "twilio:" + b.MediaUrl0 : "", b.MessageSid);
    res.type("text/xml").send(r ? `<Response><Message>${xml(r)}</Message></Response>` : "<Response/>");
  } catch (e) { console.error("Twilio:", e); res.type("text/xml").send("<Response/>"); }
});

// ---------- Canal: WhatsApp con Meta Cloud API ----------
app.get("/whatsapp", (req, res) => {
  const q = req.query;
  if (WA_VERIFY_TOKEN && q["hub.mode"] === "subscribe" && q["hub.verify_token"] === WA_VERIFY_TOKEN) return res.status(200).send(q["hub.challenge"]);
  res.sendStatus(403);
});
app.post("/whatsapp", async (req, res) => {
  if (APP_SECRET) {
    const sig = req.get("x-hub-signature-256") || "", exp = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.raw).digest("hex");
    if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return res.sendStatus(401);
  }
  res.sendStatus(200);
  try {
    const v = req.body?.entry?.[0]?.changes?.[0]?.value;
    for (const m of v?.messages ?? []) {
      const f = (m.image && m.image.id) || (m.document && m.document.id);
      const r = await conversar("whatsapp", m.from, m.text?.body || "", f ? "wa:" + f : "", m.id);
      if (r) await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${WA_PHONE_ID}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: m.from, type: "text", text: { body: r } }) });
    }
  } catch (e) { console.error("WhatsApp:", e); }
});

app.use((err, _q, r, _n) => { console.error(err); r.status(500).json({ error: "Error del servidor" }); });
pool.query(require("fs").readFileSync(path.join(__dirname, "schema.sql"), "utf8"))
  .then(() => app.listen(PORT, () => console.log(`Afiliaciones en ${BASE_URL}`)))
  .catch((e) => { console.error("No se pudo conectar a la base de datos:", e.message); process.exit(1); });
