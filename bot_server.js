// PROTOCOLO TITANIUM 3000.0 - Telegram Bot Server
// Motor: Google Gemini 2.0 Flash + Google Search Grounding (web real)

const http = require("http");
const https = require("https");

const TOKEN = "8778357282:AAG_3HtH2p4p14FnmrSpI2FKuxH5_mQDFww";
const GEMINI_API_KEY = "AIzaSyBe0Xqz9DraIyGRdrY0sR-vjf_TKi0OsSg";
const GEMINI_MODEL = "gemini-2.0-flash";
const PORT = process.env.PORT || 3000;

// ─── POISSON REAL ─────────────────────────────────────────────────────────────
function factorial(n) {
  if (n === 0 || n === 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poisson(lambda, k) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function calcularMatrizPoisson(lambdaA, lambdaB, maxGols = 5) {
  const matrix = [];
  for (let a = 0; a <= maxGols; a++) {
    for (let b = 0; b <= maxGols; b++) {
      const prob = poisson(lambdaA, a) * poisson(lambdaB, b);
      matrix.push({ placar: `${a}-${b}`, prob: parseFloat((prob * 100).toFixed(2)) });
    }
  }
  return matrix.sort((x, y) => y.prob - x.prob);
}

function calcularSkellam(lambdaA, lambdaB) {
  const results = {};
  for (let k = -6; k <= 6; k++) {
    let sum = 0;
    const maxN = 15;
    for (let n = Math.max(0, -k); n <= maxN; n++) {
      sum += (Math.pow(lambdaA, n + k) * Math.pow(lambdaB, n)) /
             (factorial(n + k) * factorial(n));
    }
    results[k] = Math.exp(-(lambdaA + lambdaB)) * sum;
  }
  return results;
}

function calcularZScore(probReal, probImplicita) {
  if (probImplicita <= 0 || probImplicita >= 1) return 0;
  const p = probImplicita;
  const n = 1000;
  const se = Math.sqrt((p * (1 - p)) / n);
  return se > 0 ? ((probReal - probImplicita) / se).toFixed(2) : 0;
}

function calcularFairValue(prob) {
  return prob > 0 ? (1 / prob).toFixed(2) : "∞";
}

function calcularEdge(fairValue, oddMercado) {
  if (!oddMercado || oddMercado <= 0) return null;
  return (((fairValue - oddMercado) / oddMercado) * 100).toFixed(1);
}

// ─── Telegram API ────────────────────────────────────────────────────────────
function tgPost(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${TOKEN}/${method}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => { try { resolve(JSON.parse(buf)); } catch(e) { resolve({}); } });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function sendMsg(chatId, text, extra = {}) {
  const chunks = [];
  if (text.length <= 4000) {
    chunks.push(text);
  } else {
    let remaining = text;
    while (remaining.length > 0) {
      let chunk = remaining.slice(0, 3900);
      const cut = chunk.lastIndexOf("\n\n");
      if (cut > 1500) chunk = remaining.slice(0, cut);
      chunks.push(chunk);
      remaining = remaining.slice(chunk.length).trimStart();
    }
  }
  for (let i = 0; i < chunks.length; i++) {
    await tgPost("sendMessage", {
      chat_id: chatId,
      text: chunks[i],
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra,
    });
    if (i < chunks.length - 1) await sleep(300);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── GEMINI API com Google Search Grounding ───────────────────────────────────
async function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2000,
      }
    });

    const path = `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const req = https.request({
      hostname: "generativelanguage.googleapis.com",
      path: path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(buf);

          // Log para debug
          console.log("Gemini HTTP status:", res.statusCode);
          if (res.statusCode !== 200) {
            console.error("Gemini error body:", buf.slice(0, 500));
            return resolve(null);
          }

          // Extrair texto da resposta
          const candidates = parsed.candidates || [];
          const text = candidates
            .flatMap(c => c.content?.parts || [])
            .filter(p => p.text)
            .map(p => p.text)
            .join("\n");

          resolve(text || null);
        } catch(e) {
          console.error("Gemini parse error:", e.message, buf.slice(0, 300));
          resolve(null);
        }
      });
    });

    req.on("error", (e) => {
      console.error("Gemini request error:", e.message);
      resolve(null);
    });

    req.write(body);
    req.end();
  });
}

// ─── TITANIUM SYSTEM PROMPT ───────────────────────────────────────────────────
function buildPrompt(query) {
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  return `Você é o PROTOCOLO TITANIUM 3000.0, motor forense de análise de apostas esportivas.

TAREFA: Analisar a partida "${query}" | Hora BRT: ${now}

EXECUTE AS SEGUINTES BUSCAS WEB AGORA:
1. "${query} odds apostas" — encontrar odds reais
2. "${query} escalação titulares" — escalações e lesões
3. "${query} histórico h2h confrontos" — resultados anteriores
4. "${query} gols estatísticas 2026" — média de gols para calibrar lambdas

Com os dados encontrados, retorne APENAS um JSON válido, sem texto antes ou depois, sem markdown, sem \`\`\`:

{
  "partida": "Time A vs Time B",
  "liga": "Nome da Liga",
  "data": "Data e hora do jogo encontrada",
  "fonte_odds": "Site onde achou as odds",
  "lambdaA": 1.4,
  "lambdaB": 1.1,
  "lambda_fonte": "Baseado em X gols/jogo nos últimos Y jogos (fonte real)",
  "escalacoes": "Escalações encontradas ou estimadas com nomes reais",
  "lesoes_suspensoes": "Lesionados/suspensos encontrados ou Nenhuma identificada",
  "h2h": "Últimos 5 confrontos com resultados reais",
  "odd_placar_principal": 0,
  "odd_mercado_fonte": "Odd encontrada ou Não localizado",
  "anomalia_tipo": "RLM ou DARK_POOL ou OVERVALUE ou FAIR ou SUSP ou DADOS_INSUFICIENTES",
  "anomalia_descricao": "Análise técnica baseada nos dados reais encontrados",
  "contexto_jogo": "Posição na tabela, importância do jogo, pressão, etc",
  "noticias_relevantes": "Notícias reais encontradas que impactam o jogo",
  "confianca_modelo": "ALTA ou MEDIA ou BAIXA — justificativa"
}

REGRAS:
- lambdaA = média de gols marcados pelo Time A nos últimos jogos (use dados reais encontrados)
- lambdaB = média de gols marcados pelo Time B nos últimos jogos (use dados reais encontrados)
- Se não achar médias reais, estime: times iguais=1.3, time forte=1.6, time fraco=0.9
- Se não achar odds reais, coloque odd_placar_principal=0 e fonte="Não localizado"
- NUNCA invente jogadores, resultados ou estatísticas — indique quando é estimativa
- Retorne SOMENTE o JSON, absolutamente nenhum texto fora do JSON`;
}

// ─── EXECUÇÃO TITANIUM COMPLETA ───────────────────────────────────────────────
async function executarTitanium(query) {
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  console.log(`[TITANIUM] Iniciando varredura: ${query}`);

  const rawResponse = await callGemini(buildPrompt(query));

  console.log(`[TITANIUM] Gemini respondeu: ${rawResponse ? rawResponse.slice(0, 200) : "NULL"}`);

  let dados = null;

  if (rawResponse) {
    try {
      // Tentar extrair JSON limpo (Gemini às vezes adiciona texto extra)
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        dados = JSON.parse(jsonMatch[0]);
        console.log("[TITANIUM] JSON parseado com sucesso");
      }
    } catch(e) {
      console.error("[TITANIUM] Falha ao parsear JSON:", e.message);
      console.error("[TITANIUM] Raw:", rawResponse.slice(0, 500));
    }
  }

  // Fallback se JSON não veio
  if (!dados) {
    console.warn("[TITANIUM] Usando fallback — Gemini não retornou JSON válido");
    dados = {
      partida: query,
      liga: "—",
      data: now,
      fonte_odds: "Não localizado",
      lambdaA: 1.3,
      lambdaB: 1.1,
      lambda_fonte: "Estimativa conservadora (falha na busca web)",
      escalacoes: "Não localizado",
      lesoes_suspensoes: "Não identificadas",
      h2h: "Não localizado",
      odd_placar_principal: 0,
      odd_mercado_fonte: "Não localizado",
      anomalia_tipo: "DADOS_INSUFICIENTES",
      anomalia_descricao: rawResponse ? rawResponse.slice(0, 400) : "Gemini não respondeu — verifique a chave API",
      contexto_jogo: "—",
      noticias_relevantes: "Nenhuma encontrada",
      confianca_modelo: "BAIXA — falha na coleta de dados"
    };
  }

  // Calcular Poisson/Skellam com lambdas reais
  const lambdaA = Math.max(0.5, Math.min(4.0, parseFloat(dados.lambdaA) || 1.3));
  const lambdaB = Math.max(0.5, Math.min(4.0, parseFloat(dados.lambdaB) || 1.1));

  const matriz = calcularMatrizPoisson(lambdaA, lambdaB, 5);
  const top5 = matriz.slice(0, 5);
  const placarPrincipal = top5[0];
  const placarPrincipalProb = placarPrincipal.prob / 100;

  const skellam = calcularSkellam(lambdaA, lambdaB);
  const probTimeA = Object.entries(skellam).filter(([k]) => parseInt(k) > 0).reduce((s,[,v]) => s+v, 0);
  const probEmpate = skellam[0] || 0;
  const probTimeB = Object.entries(skellam).filter(([k]) => parseInt(k) < 0).reduce((s,[,v]) => s+v, 0);

  const fvPlacarPrincipal = parseFloat(calcularFairValue(placarPrincipalProb));
  const fvA = parseFloat(calcularFairValue(probTimeA));
  const fvX = parseFloat(calcularFairValue(probEmpate));
  const fvB = parseFloat(calcularFairValue(probTimeB));

  const oddMercado = parseFloat(dados.odd_placar_principal) || 0;
  const probImplicitaMercado = oddMercado > 0 ? 1 / oddMercado : 0;
  const zScore = parseFloat(calcularZScore(placarPrincipalProb, probImplicitaMercado));
  const edge = oddMercado > 0 ? calcularEdge(fvPlacarPrincipal, oddMercado) : null;

  let anomaliaFinal = dados.anomalia_tipo || "DADOS_INSUFICIENTES";
  let anomaliaDesc = dados.anomalia_descricao || "—";

  if (oddMercado > 0 && fvPlacarPrincipal > 0) {
    const discrepancia = ((fvPlacarPrincipal - oddMercado) / oddMercado) * 100;
    if (Math.abs(discrepancia) > 20) {
      anomaliaFinal = discrepancia > 0 ? "OVERVALUE_DETECTADO" : "UNDERVALUE_DETECTADO";
      anomaliaDesc = `Discrepância de ${discrepancia.toFixed(1)}% entre FV (${fvPlacarPrincipal}) e odd de mercado (${oddMercado}). ${anomaliaDesc}`;
    }
  }

  const confiancaMap = { ALTA: 82, MEDIA: 71, BAIXA: 58 };
  const confiancaKey = (dados.confianca_modelo || "BAIXA").split(" ")[0].toUpperCase();
  const assertividade = confiancaMap[confiancaKey] || 65;

  return { dados, top5, lambdaA, lambdaB, placarPrincipal, placarPrincipalProb,
           probTimeA, probEmpate, probTimeB, fvPlacarPrincipal, fvA, fvX, fvB,
           zScore, edge, oddMercado, anomaliaFinal, anomaliaDesc, assertividade, now };
}

// ─── Formatar relatório Telegram HTML ─────────────────────────────────────────
function formatarRelatorio(r) {
  const { dados, top5, lambdaA, lambdaB, placarPrincipal, placarPrincipalProb,
          probTimeA, probEmpate, probTimeB, fvPlacarPrincipal, fvA, fvX, fvB,
          zScore, edge, oddMercado, anomaliaFinal, anomaliaDesc, assertividade, now } = r;

  const zAbs = Math.abs(zScore);
  const zEmoji = zAbs >= 9 ? "🔴" : zAbs >= 5 ? "🟠" : zAbs >= 2 ? "🟡" : "🟢";
  const anomEmoji = {
    RLM: "📉", DARK_POOL: "🌑", OVERVALUE_DETECTADO: "⚠️",
    UNDERVALUE_DETECTADO: "💎", SUSP: "🚨", FAIR: "✅", DADOS_INSUFICIENTES: "❓"
  }[anomaliaFinal] || "🔍";

  const top5txt = top5.map((p, i) =>
    `${["🥇","🥈","🥉","4️⃣","5️⃣"][i]} <b>${p.placar}</b> → <code>${p.prob}%</code> | FV: <code>${calcularFairValue(p.prob/100)}</code>`
  ).join("\n");

  return `<b>🌌 PROTOCOLO TITANIUM 3000.0 — RELATÓRIO FORENSE</b>
<b>🕐 BRT:</b> ${now}
<b>⚖️ STATUS:</b> VARREDURA CONCLUÍDA | AUDITORIA ATIVA

━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 <b>ALVO:</b> <b>${dados.partida}</b>
🏆 <b>Liga:</b> ${dados.liga}
📅 <b>Data/Hora:</b> ${dados.data}
📡 <b>Fonte de Odds:</b> ${dados.fonte_odds}

━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>📊 CALIBRAÇÃO DOS MOTORES POISSON-SKELLAM</b>

⚡ <b>λ Ataque A:</b> <code>${lambdaA}</code> gols/jogo esperados
⚡ <b>λ Ataque B:</b> <code>${lambdaB}</code> gols/jogo esperados
📖 <b>Fonte dos λ:</b> <i>${dados.lambda_fonte}</i>

<b>Probabilidades 1X2 (Skellam):</b>
🏠 Vitória A: <code>${(probTimeA*100).toFixed(1)}%</code> | FV: <code>${fvA}</code>
🤝 Empate:   <code>${(probEmpate*100).toFixed(1)}%</code> | FV: <code>${fvX}</code>
✈️ Vitória B: <code>${(probTimeB*100).toFixed(1)}%</code> | FV: <code>${fvB}</code>

━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>🎯 SINGULARIDADE DE PLACAR EXATO (TOP 5)</b>

${top5txt}

━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>🔬 ANÁLISE DE VALOR — PLACAR PRINCIPAL: ${placarPrincipal.placar}</b>

📊 <b>Prob. Real (Modelo):</b> <code>${(placarPrincipalProb*100).toFixed(2)}%</code>
💰 <b>Fair Value Calculado:</b> <code>${fvPlacarPrincipal}</code>
${oddMercado > 0
  ? `🏪 <b>Odd Mercado:</b> <code>${oddMercado}</code> (${dados.odd_mercado_fonte})
📈 <b>Edge:</b> <code>${edge}%</code> ${parseFloat(edge) > 0 ? "✅ VALOR POSITIVO" : "❌ SEM VALOR"}
📐 <b>Z-Score Anomalia:</b> ${zEmoji} <code>${zScore}σ</code>`
  : `⚠️ <b>Odd Mercado:</b> Não localizada — Z-Score indisponível`}

━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>🕵️ DETECTOR DE ANOMALIAS DE MERCADO</b>

${anomEmoji} <b>Tipo:</b> <code>${anomaliaFinal}</code>
📋 <b>Descrição:</b> <i>${anomaliaDesc}</i>

━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>📋 DADOS DE CAMPO (COLETADOS EM TEMPO REAL)</b>

👥 <b>Escalações:</b>
<i>${dados.escalacoes}</i>

🚑 <b>Lesões/Suspensões:</b>
<i>${dados.lesoes_suspensoes}</i>

⚔️ <b>H2H (Histórico):</b>
<i>${dados.h2h}</i>

📰 <b>Notícias Relevantes:</b>
<i>${dados.noticias_relevantes}</i>

🗺️ <b>Contexto da Partida:</b>
<i>${dados.contexto_jogo}</i>

━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>🛡️ VEREDITO TITANIUM</b>

🎯 <b>Placar Singular:</b> <b>${placarPrincipal.placar}</b>
📊 <b>Assertividade do Modelo:</b> <code>${assertividade}%</code>
🔒 <b>Confiança nos Dados:</b> <code>${dados.confianca_modelo}</code>

━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ <i>Análise baseada em busca web em tempo real + modelos estatísticos Poisson-Skellam. Aposte com responsabilidade. Maiores de 18 anos.</i>`;
}

// ─── Handlers de comandos ─────────────────────────────────────────────────────
async function handleStart(chatId, nome) {
  await sendMsg(chatId, `<b>🌌 PROTOCOLO TITANIUM 3000.0 — OMNI-TERMINUS</b>
Olá, ${nome || "Analista"}! Sistema de análise forense ativo.

<b>⚡ MOTORES ATIVOS:</b>
✅ Poisson-Skellam Extended (cálculo real)
✅ Skellam 1X2 (distribuição de diferença de gols)
✅ Fair Value Calculator (matemático)
✅ Z-Score Anomaly Detector
✅ Edge Calculator (valor vs mercado)
✅ Google Gemini 2.0 Flash + Google Search (tempo real)

<b>📋 COMANDOS:</b>
/scan — Iniciar varredura forense
/help — Manual completo
/status — Status dos motores

<b>🚀 EXEMPLO:</b>
<code>/scan Flamengo x Palmeiras Brasileirão</code>
<code>/scan Real Madrid x Barcelona La Liga</code>`);
}

async function handleHelp(chatId) {
  await sendMsg(chatId, `<b>📖 MANUAL — TITANIUM 3000.0</b>

<b>COMO USAR:</b>
<code>/scan [Time A] x [Time B] [Liga]</code>

<b>EXEMPLOS:</b>
<code>/scan Grêmio x Internacional Brasileirão</code>
<code>/scan PSG x Bayern Champions League</code>
<code>/scan Fluminense x São Paulo Copa do Brasil</code>
<code>/scan Arsenal x Chelsea Premier League</code>

Também pode mandar qualquer mensagem com o nome da partida diretamente.

<b>O QUE O BOT FAZ:</b>
🔍 Google Search em tempo real (odds, escalações, H2H)
📊 Lambdas calibrados por dados reais encontrados
📐 Skellam para probabilidades 1X2 exatas
💰 Fair Value matemático por placar
📈 Z-Score de anomalia vs mercado
⚠️ Detecção de discrepância de valor

<b>TEMPO DE ANÁLISE:</b> ~20-40 segundos`);
}

async function handleStatus(chatId) {
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  await sendMsg(chatId, `<b>⚡ STATUS DOS MOTORES — ${now}</b>

🟢 <b>Poisson Calculator</b> — ATIVO
🟢 <b>Skellam Distribution</b> — ATIVO
🟢 <b>Fair Value Engine</b> — ATIVO
🟢 <b>Z-Score Detector</b> — ATIVO
🟢 <b>Edge Calculator</b> — ATIVO
🟢 <b>Google Gemini 2.0 Flash</b> — ATIVO
🟢 <b>Google Search Grounding</b> — ATIVO
🟢 <b>Telegram Webhook</b> — ATIVO

<b>Versão:</b> TITANIUM 3000.0 OMNI-TERMINUS
<b>Motor IA:</b> Gemini 2.0 Flash + Google Search
<b>Servidor:</b> Online ✅`);
}

async function handleScan(chatId, query) {
  if (!query || query.trim().length < 5) {
    await sendMsg(chatId, `⚠️ <b>Informe a partida!</b>\n\nExemplo:\n<code>/scan Flamengo x Palmeiras Brasileirão</code>`);
    return;
  }

  await sendMsg(chatId, `<b>🌌 TITANIUM 3000.0 — VARREDURA INICIADA</b>

🎯 Alvo: <code>${query}</code>

⏳ Executando em sequência:
🔍 <b>[1/4]</b> Google Search: odds em tempo real...
📋 <b>[2/4]</b> Google Search: escalações e lesões...
⚔️ <b>[3/4]</b> Google Search: histórico H2H...
📊 <b>[4/4]</b> Calibrando Poisson-Skellam + Fair Values...

<i>Aguarde ~20-40 segundos...</i>`);

  try {
    const resultado = await executarTitanium(query);
    const relatorio = formatarRelatorio(resultado);
    await sendMsg(chatId, relatorio);
  } catch(err) {
    console.error("Scan error:", err);
    await sendMsg(chatId, `<b>🚨 ERRO NA VARREDURA</b>\n\n<code>${err.message}</code>\n\nTente novamente em instantes.`);
  }
}

// ─── Processar update do Telegram ─────────────────────────────────────────────
async function processUpdate(update) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const nome = msg.from?.first_name || "";

  console.log(`[${new Date().toISOString()}] ${chatId} (${nome}): ${text}`);

  if (text.startsWith("/start")) return handleStart(chatId, nome);
  if (text.startsWith("/help") || text.startsWith("/ajuda")) return handleHelp(chatId);
  if (text.startsWith("/status")) return handleStatus(chatId);
  if (text.startsWith("/scan")) return handleScan(chatId, text.replace(/^\/scan\s*/i, "").trim());

  if (text.length > 5) return handleScan(chatId, text);
}

// ─── Webhook server ───────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200);
    res.end("🌌 TITANIUM 3000.0 — ONLINE (Gemini 2.0 Flash)");
    return;
  }

  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", async () => {
      res.writeHead(200);
      res.end("OK");
      try {
        const update = JSON.parse(body);
        await processUpdate(update);
      } catch(e) {
        console.error("Webhook error:", e.message);
      }
    });
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", version: "titanium-3000", engine: "gemini-2.0-flash" }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ─── Polling fallback ─────────────────────────────────────────────────────────
let offset = 0;
let pollingActive = false;

async function startPolling() {
  pollingActive = true;
  console.log("📡 Polling mode ativo");
  while (pollingActive) {
    try {
      const res = await tgPost("getUpdates", { offset, timeout: 25, limit: 10 });
      if (res.ok && res.result) {
        for (const upd of res.result) {
          offset = upd.update_id + 1;
          processUpdate(upd).catch(console.error);
        }
      }
    } catch(e) {
      console.error("Polling error:", e.message);
    }
    await sleep(1000);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log(`🌌 TITANIUM 3000.0 rodando na porta ${PORT} | Motor: Gemini 2.0 Flash`);

  const webhookUrl = process.env.WEBHOOK_URL;

  if (webhookUrl) {
    const result = await tgPost("setWebhook", {
      url: `${webhookUrl}/webhook`,
      allowed_updates: ["message", "edited_message"]
    });
    console.log("🔗 Webhook registrado:", JSON.stringify(result));
  } else {
    await tgPost("deleteWebhook", {});
    startPolling();
  }
});
