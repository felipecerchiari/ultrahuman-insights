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
    "Voce e um assistente de saude pessoal que analisa os dados do anel Ultrahuman do usuario (Cerchi). " +
    "Responda SEMPRE em portugues do Brasil, de forma curta, direta e pratica. " +
    "Baseie-se nos dados fornecidos (medias do periodo, ultimos dias e correlacoes). Cite numeros quando ajudar. " +
    "Correlacao nao e causalidade: trate padroes como pistas, nao certezas. " +
    "Voce NAO e medico: para sintomas ou decisoes clinicas, sugira procurar um profissional. " +
    "Se a pergunta nao puder ser respondida com os dados, diga isso com honestidade.\n\n" +
    "DADOS (JSON):\n" + JSON.stringify(context).slice(0, 14000);

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
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.4, max_tokens: 600 }),
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
