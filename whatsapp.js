// Twilio WhatsApp webhook: receives a message, fetches ring data, asks OpenAI, replies via TwiML.
import crypto from "node:crypto";

const TOKEN = process.env.UH_TOKEN || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://ultrahuman-insights.vercel.app/api/whatsapp";
const ALLOW = process.env.UH_WA_ALLOW || ""; // optional: "whatsapp:+55..."
const API = "https://partner.ultrahuman.com/api/v1/partner/daily_metrics";

function num(v) {
  if (v && typeof v === "object") return (v.value ?? v.score ?? v.avg ?? v.percentage ?? v.celsius ?? null);
  return (typeof v === "number" ? v : null);
}
function parseDay(items) {
  const m = {}; items.forEach((it) => { m[it.type] = it.object; });
  const s = m.sleep || {};
  return {
    sleep_score: s.sleep_score ? (s.sleep_score.score ?? null) : null,
    recovery: num(m.recovery_index),
    hrv: num(m.avg_sleep_hrv),
    rhr: (m.night_rhr && typeof m.night_rhr === "object") ? (m.night_rhr.avg ?? null) : num(m.night_rhr),
    total_sleep: s.total_sleep ? +(((s.total_sleep.seconds) || 0) / 3600).toFixed(2) : null,
    deep_sleep: s.deep_sleep ? (s.deep_sleep.minutes ?? null) : null,
    rem_sleep: s.rem_sleep ? (s.rem_sleep.minutes ?? null) : null,
    temp_dev: s.temperature_deviation ? (s.temperature_deviation.celsius ?? null) : null,
    steps: (m.steps && Array.isArray(m.steps.values)) ? m.steps.values.reduce((a, b) => a + (b.value || 0), 0) : null,
  };
}
function fmt(d) { return d.toISOString().slice(0, 10); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function reply(res, msg) {
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>' + esc(msg) + '</Message></Response>');
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).send("POST only"); return; }
  const params = (req.body && typeof req.body === "object") ? req.body : {};

  // security: validate Twilio signature if auth token is set; else optional From allowlist
  if (TW_TOKEN) {
    const sig = req.headers["x-twilio-signature"] || "";
    const data = WEBHOOK_URL + Object.keys(params).sort().map((k) => k + params[k]).join("");
    const expected = crypto.createHmac("sha1", TW_TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
    if (sig !== expected) { res.status(403).send("invalid signature"); return; }
  } else if (ALLOW && (params.From || "") !== ALLOW) {
    res.status(403).send("forbidden"); return;
  }

  if (!TOKEN || !OPENAI_KEY) { reply(res, "Servidor ainda nao configurado."); return; }
  const body = String(params.Body || "").trim();
  if (!body) { reply(res, "Oi! Manda uma pergunta sobre seus dados do anel. Ex: como foi minha noite?"); return; }

  // fetch last 21 days
  const today = new Date(); today.setUTCHours(12, 0, 0, 0);
  const dates = [];
  for (let i = 1; i <= 21; i++) { const d = new Date(today); d.setUTCDate(d.getUTCDate() - i); dates.push(fmt(d)); }
  const recs = []; let idx = 0;
  async function w() {
    while (idx < dates.length) {
      const dd = dates[idx++];
      try {
        const r = await fetch(API + "?date=" + dd, { headers: { Authorization: TOKEN } });
        if (r.ok) { const j = await r.json(); const it = ((j.data || {}).metrics || {})[dd]; if (it) recs.push({ date: dd, ...parseDay(it) }); }
      } catch (e) {}
    }
  }
  await Promise.all(Array.from({ length: 15 }, w));
  recs.sort((a, b) => (a.date < b.date ? -1 : 1));

  const keys = ["sleep_score", "recovery", "hrv", "rhr", "total_sleep"];
  const mean = (k) => { const v = recs.map((r) => r[k]).filter((x) => x != null && !isNaN(x)); return v.length ? +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(1) : null; };
  const base = {}; keys.forEach((k) => { base[k] = mean(k); });
  let last = null; for (let i = recs.length - 1; i >= 0; i--) { if (recs[i].sleep_score != null) { last = recs[i]; break; } }
  const ctx = { periodo_dias: recs.length, baseline_media: base, ultima_noite: last, ultimos_7_dias: recs.slice(-7) };

  const sys =
    "Voce e um analista de saude pessoal perspicaz que analisa os dados do anel Ultrahuman do Cerchi e responde por WhatsApp. " +
    "Responda em portugues do Brasil, MUITO curto (1 a 4 frases, cabe numa mensagem). " +
    "Va direto ao ponto mais relevante e SEMPRE ancore em numeros do Cerchi (valor vs media/baseline dele, com %). " +
    "Nada de conselho generico sem dado. De no maximo 1 acao concreta. " +
    "Correlacao nao e causalidade. Voce nao e medico: para sintomas serios sugira um profissional.\n\n" +
    "DADOS (JSON):\n" + JSON.stringify(ctx).slice(0, 9000);

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + OPENAI_KEY },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: sys }, { role: "user", content: body.slice(0, 500) }], temperature: 0.4, max_tokens: 320 }),
    });
    const j = await r.json();
    if (!r.ok) { reply(res, "Nao consegui consultar a IA agora (" + ((j.error && j.error.message) || ("HTTP " + r.status)) + ")."); return; }
    const ans = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "(sem resposta)";
    reply(res, ans);
  } catch (e) {
    reply(res, "Erro ao processar: " + String(e));
  }
}
