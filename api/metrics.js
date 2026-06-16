// Serverless function (Vercel). Runs server-side: no CORS, token never reaches the browser.
const TOKEN = process.env.UH_TOKEN || "";
const PASSWORD = process.env.UH_PASSWORD || "";
const API = "https://partner.ultrahuman.com/api/v1/partner/daily_metrics";

function num(v) {
  if (v && typeof v === "object") return (v.value ?? v.score ?? v.avg ?? v.percentage ?? v.celsius ?? null);
  return (typeof v === "number" ? v : null);
}
function parseDay(items) {
  const m = {};
  items.forEach((it) => { m[it.type] = it.object; });
  const s = m.sleep || {};
  const steps = (m.steps && Array.isArray(m.steps.values))
    ? m.steps.values.reduce((a, b) => a + (b.value || 0), 0) : null;
  return {
    sleep_score: s.sleep_score ? (s.sleep_score.score ?? null) : null,
    recovery: num(m.recovery_index),
    hrv: num(m.avg_sleep_hrv),
    rhr: (m.night_rhr && typeof m.night_rhr === "object") ? (m.night_rhr.avg ?? null) : num(m.night_rhr),
    total_sleep: s.total_sleep ? +(((s.total_sleep.seconds) || 0) / 3600).toFixed(2) : null,
    deep_sleep: s.deep_sleep ? (s.deep_sleep.minutes ?? null) : null,
    rem_sleep: s.rem_sleep ? (s.rem_sleep.minutes ?? null) : null,
    light_sleep: s.light_sleep ? (s.light_sleep.minutes ?? null) : null,
    sleep_eff: s.sleep_efficiency ? (s.sleep_efficiency.percentage ?? null) : null,
    temp_dev: s.temperature_deviation ? (s.temperature_deviation.celsius ?? null) : null,
    restorative: s.restorative_sleep ? (s.restorative_sleep.percentage ?? null) : null,
    steps,
    movement: num(m.movement_index),
    vo2: num(m.vo2_max),
    active_min: num(m.active_minutes),
  };
}
function fmt(d) { return d.toISOString().slice(0, 10); }

async function fetchDay(dateStr) {
  try {
    const r = await fetch(`${API}?date=${dateStr}`, { headers: { Authorization: TOKEN } });
    if (!r.ok) return null;
    const j = await r.json();
    const items = ((j.data || {}).metrics || {})[dateStr];
    if (!items) return null;
    return { date: dateStr, ...parseDay(items) };
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  if (!TOKEN || !PASSWORD) {
    res.status(500).json({ error: "server not configured (set UH_TOKEN and UH_PASSWORD env vars)" });
    return;
  }
  const pw = (req.query.pw || req.headers["x-pw"] || "");
  if (pw !== PASSWORD) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  let days = parseInt(req.query.days || "90", 10);
  if (isNaN(days) || days < 7) days = 90;
  if (days > 180) days = 180;

  const today = new Date(); today.setUTCHours(12, 0, 0, 0);
  const dates = [];
  for (let i = 1; i <= days; i++) { const d = new Date(today); d.setUTCDate(d.getUTCDate() - i); dates.push(fmt(d)); }

  const out = [];
  const CONC = 12;
  let idx = 0;
  async function worker() {
    while (idx < dates.length) {
      const d = dates[idx++];
      const rec = await fetchDay(d);
      if (rec) out.push(rec);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  out.sort((a, b) => (a.date < b.date ? -1 : 1));

  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).json({ generated: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", nDays: out.length, records: out });
}
