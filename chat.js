// Chat handler — talks to OpenAI with the user's ring data as context.
// Server-side: the OpenAI key never reaches the browser. Password-gated.
const PASSWORD = process.env.UH_PASSWORD || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!PASSWORD || !OPENAI_KEY) {
    res.status(500).json({ error: "server not configured (set UH_PASSWORD and OPENAI_API_KEY env vars)" });
    return;
  }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  if (body.pw !== PASSWORD) { res.status(401).json({ error: "unauthorized" }); return; }
  const question = String(body.question || "").slice(0, 800);
  if (!question) { res.status(400).json({ error: "no question" }); return; }
  const context = body.context || {};
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];

  const sys =
    "Voce e um analista de dados de saude pessoal, perspicaz e direto, analisando os dados do anel Ultrahuman do Cerchi. Responda em portugues do Brasil.\n" +
    "PRINCIPIOS:\n" +
    "- Va direto ao insight mais relevante. NADA de conselho generico ('durma bem', 'hidrate-se') sem ancorar nos numeros dele.\n" +
    "- Sempre quantifique: compare o valor com a media/baseline dele, usando numeros, % e desvios (z) quando der.\n" +
    "- Use as correlacoes fornecidas para identificar a MAIOR alavanca (o que mais move o recovery/HRV dele) e diga isso explicitamente, com o r.\n" +
    "- De 1 a 2 acoes concretas e especificas, nao obvias, conectadas aos dados dele.\n" +
    "- Seja honesto sobre incerteza; correlacao nao e causalidade; diga quando os dados nao bastam (ex: poucos dias, falta de log de habitos).\n" +
    "- Voce NAO e medico: para sintomas ou decisoes clinicas, sugira um profissional.\n" +
    "- Formato: 2 a 5 frases ou bullets curtos. Sem enrolacao, sem repetir a pergunta.\n\n" +
    "DADOS (JSON):\n" + JSON.stringify(context).slice(0, 16000);

  const messages = [{ role: "system", content: sys }];
  for (const h of history) {
    if (h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string") {
      messages.push({ role: h.role, content: h.content.slice(0, 1500) });
    }
  }
  messages.push({ role: "user", content: question });

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + OPENAI_KEY },
      body: JSON.stringify({ model: MODEL, messages, max_completion_tokens: 1500 }),
    });
    const j = await r.json();
    if (!r.ok) {
      res.status(502).json({ error: "openai_error", detail: (j.error && j.error.message) || ("HTTP " + r.status) });
      return;
    }
    const answer = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "(sem resposta)";
    res.status(200).json({ answer });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
