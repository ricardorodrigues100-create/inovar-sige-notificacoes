import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// Garante que esta rota nunca é cacheada/estatizada pelo Next.js
export const dynamic = "force-dynamic";

const BASE_URL = "https://portalsige.damiaodegoes.pt/InovarSIGE";

// Cabeçalhos que fazem o pedido parecer vindo de um browser normal —
// alguns sites bloqueiam pedidos que não os têm.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
};

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

type InovarEvent = {
  ID: number;
  Data: string; // formato "/Date(1789456708957)/"
  Local: string;
  Tipo: number;
  PontoAcesso: string;
  Motivo: string;
  Permitido: number;
  Obs: string;
};

/** Extrai e junta todos os cookies Set-Cookie de uma resposta fetch. */
function extractCookies(headers: Headers): string {
  // getSetCookie() existe no runtime Node.js (undici) usado pelas API routes.
  const raw = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

/** Lista só os nomes dos cookies (sem valores) para diagnóstico seguro. */
function cookieNames(cookieStr: string): string[] {
  return cookieStr
    .split("; ")
    .filter(Boolean)
    .map((c) => c.split("=")[0]);
}

/** Converte o formato de data do ASP.NET "/Date(169999...)/" para Date. */
function parseAspNetDate(value: string): Date {
  const match = value.match(/\d+/);
  return new Date(Number(match?.[0] ?? 0));
}

/** Traduz o código Tipo do InovarSIGE em rótulo e ícone (confirmado com dados reais). */
function eventLabel(tipo: number): { label: string; icon: string; color: string } {
  if (tipo === 1) return { label: "Entrada", icon: "⬇", color: "#2e7d32" };
  if (tipo === 9) return { label: "Saída", icon: "⬆", color: "#2e7d32" };
  return { label: `Tipo ${tipo}`, icon: "•", color: "#666" };
}

/** Faz login no InovarSIGE e devolve a string de cookies da sessão autenticada. */
async function login(): Promise<string> {
  const body = new URLSearchParams({
    Type: "0", // 0 = Utilizador (Nº de Cartão + PIN)
    User: process.env.INOVAR_USER!,
    Password: process.env.INOVAR_PASSWORD!,
  });

  const res = await fetch(`${BASE_URL}/`, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BASE_URL}/`,
    },
    body: body.toString(),
    redirect: "manual",
  });

  let cookies = extractCookies(res.headers);

  // Se o servidor responder com um redirect, os cookies de autenticação
  // por vezes só vêm nessa segunda resposta — seguimos manualmente.
  if (res.status === 302 || res.status === 301) {
    const location = res.headers.get("location") ?? "/";
    const res2 = await fetch(new URL(location, `${BASE_URL}/`).toString(), {
      headers: {
        ...BROWSER_HEADERS,
        ...(cookies ? { Cookie: cookies } : {}),
      },
      redirect: "manual",
    });
    const cookies2 = extractCookies(res2.headers);
    if (cookies2) cookies = cookies ? `${cookies}; ${cookies2}` : cookies2;
  }

  if (!cookies) {
    throw new Error(
      `Login no InovarSIGE falhou: nenhum cookie de sessão foi recebido (status ${res.status}). Verifica as credenciais.`
    );
  }

  const names = cookieNames(cookies);
  const hasAuthCookie = names.some((n) => n.toLowerCase().includes("aspxauth"));
  if (!hasAuthCookie) {
    throw new Error(
      `Login pode ter falhado: recebi os cookies [${names.join(", ")}] mas falta o cookie de autenticação (status do POST de login: ${res.status}). Verifica o INOVAR_USER, INOVAR_PASSWORD e se o Type (0 ou 1) está correto.`
    );
  }

  return cookies;
}

/** Vai buscar o histórico de entradas/saídas do aluno. Lança erro se a sessão for inválida. */
async function fetchHistory(cookie: string): Promise<InovarEvent[]> {
  const body = new URLSearchParams({
    sort: "",
    page: "1",
    pageSize: "10",
    group: "",
    filter: "",
    id: process.env.INOVAR_STUDENT_ID!,
    home: "true",
  });

  const res = await fetch(`${BASE_URL}/Access/GetHistoryByUtilizador`, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
      Referer: `${BASE_URL}/`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: body.toString(),
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.includes("application/json")) {
    const snippet = (await res.text()).slice(0, 300).replace(/\s+/g, " ");
    throw new Error(
      `Sessão inválida ou expirada (status ${res.status}, content-type "${contentType}"): ${snippet}`
    );
  }

  const json = await res.json();
  return (json.Data ?? []) as InovarEvent[];
}

/** Vai buscar o histórico, mas devolve null (em vez de lançar erro) se a sessão parecer inválida. */
async function tryFetchHistory(cookie: string): Promise<InovarEvent[] | null> {
  try {
    return await fetchHistory(cookie);
  } catch {
    return null;
  }
}

/** TEMPORÁRIO — só para diagnóstico: devolve a resposta em bruto do GetDocumentosByConta. */
async function debugFetchDocumentos(cookie: string) {
  const body = new URLSearchParams({
    sort: "Data-desc",
    page: "1",
    pageSize: "5",
    group: "",
    filter: "",
  });
  const url = `${BASE_URL}/Transactions/GetDocumentosByConta?contaID=${process.env.INOVAR_CONTA_ID}&TipoConta=Normal`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
      Referer: `${BASE_URL}/`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: body.toString(),
  });
  const text = await res.text();
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    bodyPreview: text.slice(0, 2000),
  };
}

const SESSION_ROW_ID = 1;

/** Lê o cookie de sessão guardado na Supabase, se existir. */
async function getStoredCookie(): Promise<string | null> {
  const { data } = await supabase
    .from("inovar_session")
    .select("cookie")
    .eq("id", SESSION_ROW_ID)
    .maybeSingle();
  return data?.cookie ?? null;
}

/** Guarda o cookie de sessão na Supabase para reutilizar nas próximas verificações. */
async function storeCookie(cookie: string): Promise<void> {
  await supabase.from("inovar_session").upsert({
    id: SESSION_ROW_ID,
    cookie,
    updated_at: new Date().toISOString(),
  });
}

export async function GET(request: Request) {
  // Protege o endpoint com um segredo partilhado, para que só o teu
  // agendador (Vercel Cron, GitHub Actions, cron-job.org, etc.) o consiga chamar.
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // Tenta primeiro reutilizar a sessão guardada, para evitar logins repetidos
    // (fazer login com muita frequência pode acabar por bloquear a conta).
    let cookie = await getStoredCookie();
    let events = cookie ? await tryFetchHistory(cookie) : null;

    if (!events) {
      cookie = await login();
      await storeCookie(cookie);
      events = await fetchHistory(cookie);
    }

    const newEvents: InovarEvent[] = [];

    // A API devolve os eventos mais recentes primeiro; verificamos cada um
    // contra a tabela de eventos já vistos na Supabase.
    for (const event of events) {
      const { data: existing } = await supabase
        .from("inovar_events")
        .select("id")
        .eq("id", event.ID)
        .maybeSingle();

      if (!existing) {
        newEvents.push(event);
        await supabase.from("inovar_events").insert({
          id: event.ID,
          data: parseAspNetDate(event.Data).toISOString(),
          local: event.Local,
          tipo: event.Tipo,
          ponto_acesso: event.PontoAcesso,
          motivo: event.Motivo,
          permitido: event.Permitido,
          obs: event.Obs,
        });
      }
    }

    let emailError: string | null = null;
    if (newEvents.length > 0) {
      const linhasTexto = newEvents
        .map((e) => {
          const { label, icon } = eventLabel(e.Tipo);
          const dataFormatada = parseAspNetDate(e.Data).toLocaleString("pt-PT", {
            timeZone: "Europe/Lisbon",
            dateStyle: "short",
            timeStyle: "short",
          });
          return `${icon} ${label} — ${dataFormatada} — ${e.Local} (${e.PontoAcesso})`;
        })
        .join("\n");

      const linhasHtml = newEvents
        .map((e) => {
          const { label, icon, color } = eventLabel(e.Tipo);
          const dataFormatada = parseAspNetDate(e.Data).toLocaleString("pt-PT", {
            timeZone: "Europe/Lisbon",
            dateStyle: "short",
            timeStyle: "short",
          });
          return `
            <li style="padding:10px 0;border-bottom:1px solid #eee;list-style:none;">
              <span style="color:${color};font-weight:bold;font-size:15px;">${icon} ${label}</span>
              <span style="float:right;color:#333;font-size:14px;">${dataFormatada}</span>
              <div style="clear:both;color:#777;font-size:13px;margin-top:2px;">
                ${e.Local} · ${e.PontoAcesso}
              </div>
            </li>`;
        })
        .join("");

      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;">
          <h2 style="font-size:17px;color:#222;">InovarSIGE — novo(s) registo(s)</h2>
          <ul style="padding:0;margin:0;">${linhasHtml}</ul>
        </div>`;

      const { error } = await resend.emails.send({
        from: process.env.NOTIFY_FROM_EMAIL!,
        to: process.env.NOTIFY_TO_EMAIL!,
        subject: `InovarSIGE: ${newEvents.length} novo(s) registo(s)`,
        text: linhasTexto,
        html,
      });

      if (error) {
        console.error("Resend falhou ao enviar:", error);
        emailError = error.message ?? JSON.stringify(error);
      }
    }

    return NextResponse.json({
      checked: events.length,
      new: newEvents.length,
      emailError,
      ...(new URL(request.url).searchParams.get("debug") === "1"
        ? { debugDocumentos: await debugFetchDocumentos(cookie!) }
        : {}),
    });
  } catch (err) {
    console.error("Erro ao verificar InovarSIGE:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
