// Nauka Hani – powiadomienia push. Uruchamiana co 15 min przez pg_cron (supabase/cron.sql).
// GET ?vapid=1 zwraca publiczny klucz VAPID (generowany przy pierwszym wywołaniu, trzymany w app_secrets).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

type Keys = { publicKey: string; privateKey: string };
async function vapid(): Promise<Keys> {
  const { data } = await sb.from("app_secrets").select("value").eq("name", "vapid").maybeSingle();
  if (data) return data.value as Keys;
  const k = webpush.generateVAPIDKeys();
  await sb.from("app_secrets").insert({ name: "vapid", value: k });
  const again = await sb.from("app_secrets").select("value").eq("name", "vapid").single();
  return again.data!.value as Keys;
}

function nowIn(tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
const minTxt = (n: number) => n === 1 ? "minuta" : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 > 20)) ? "minuty" : "minut";

async function send(userId: string, day: string, slot: string, msg: { title: string; body: string; tag?: string }, log: string[]) {
  const ins = await sb.from("sent").insert({ user_id: userId, day, slot });
  if (ins.error) return; // już wysłane (klucz główny)
  const { data: subs } = await sb.from("push_subs").select("endpoint, sub").eq("user_id", userId);
  for (const s of subs || []) {
    try { await webpush.sendNotification(s.sub, JSON.stringify(msg), { TTL: 3600 }); log.push(`ok ${slot}`); }
    catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      log.push(`err ${slot} ${code}`);
      if (code === 404 || code === 410) await sb.from("push_subs").delete().eq("endpoint", s.endpoint);
    }
  }
}

async function run() {
  const log: string[] = [];
  const [{ data: fams }, { data: mems }] = await Promise.all([sb.from("families").select("*"), sb.from("members").select("*")]);
  for (const f of fams || []) {
    const { day, min } = nowIn(f.tz || "Europe/Warsaw");
    const kids = (mems || []).filter((m) => m.family_id === f.id && m.role === "child");
    const parents = (mems || []).filter((m) => m.family_id === f.id && m.role === "parent");
    const { data: off } = await sb.from("events").select("id").eq("family_id", f.id).eq("kind", "dayoff").eq("day", day).limit(1);
    const dayoff = !!(off && off.length);
    for (const k of kids) {
      const { data: d } = await sb.from("days").select("*").eq("user_id", k.user_id).eq("day", day).maybeSingle();
      const done = d?.active_min || 0, goal = f.goal_min || 60, left = Math.max(1, goal - done);
      const times: string[] = f.remind_times || [];
      if (!dayoff && done < goal && min < 20 * 60) {
        for (let i = 0; i < times.length; i++) {
          const t = toMin(times[i]);
          if (min >= t && min < t + 60) {
            const last = i === times.length - 1;
            const body = done === 0
              ? (i === 0 ? "Dziś jeszcze bez nauki. Jedna runda to ok. 5 minut – zacznij od jednej 💪" : "Dalej 0 minut. Zrób chociaż jedną krótką rundę – seria czeka 🔥")
              : `Masz już ${done} ${minTxt(done)}. Brakuje ${left} – to ok. ${Math.ceil(left / 5)} ${Math.ceil(left / 5) === 1 ? "runda" : Math.ceil(left / 5) <= 4 ? "rundy" : "rund"}${last ? ". Ostatnie przypomnienie dziś!" : "."}`;
            await send(k.user_id, day, "r" + times[i], { title: "Nauka Hani", body, tag: "przypomnienie" }, log);
          }
        }
      }
      for (const p of parents) {
        if (done >= goal) await send(p.user_id, day, "goal", { title: "🎉 Cel zrobiony", body: `${k.name} ma dziś ${done} ${minTxt(done)} nauki${d?.rounds ? ` (${d.rounds} rund)` : ""}.`, tag: "cel" }, log);
        const rt = toMin(f.report_time || "21:00");
        if (min >= rt && min < rt + 90) {
          const subj = Object.entries((d?.subjects || {}) as Record<string, number>).filter(([, m]) => m > 0).map(([n, m]) => `${n} ${m} min`).join(", ");
          const body = done
            ? `${k.name}: ${done}/${goal} min ${done >= goal ? "✅" : "⏳"}${subj ? " · " + subj : ""}${d?.coins != null ? ` · 🪙 ${d.coins}` : ""}`
            : `${k.name} dziś się nie uczyła${dayoff ? " (dzień wolny)" : ""}.`;
          await send(p.user_id, day, "report", { title: "Raport dnia", body, tag: "raport" }, log);
        }
      }
      const since = new Date(Date.now() - 2 * 864e5).toISOString();
      const { data: cl } = await sb.from("claims").select("id, price, reward_id, rewards(title)").eq("child_id", k.user_id).eq("status", "pending").gte("created_at", since);
      for (const c of cl || []) {
        const title = (c as unknown as { rewards?: { title?: string } }).rewards?.title || "nagroda";
        for (const p of parents) await send(p.user_id, day, "claim:" + c.id, { title: "🎁 Prośba o nagrodę", body: `${k.name} chce wymienić ${c.price} monet: ${title}.`, tag: "nagroda" }, log);
      }
    }
  }
  return log;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const k = await vapid();
  if (url.searchParams.has("vapid")) return json({ publicKey: k.publicKey });
  webpush.setVapidDetails("https://lukassk1892.github.io/Nauka-Hani/", k.publicKey, k.privateKey);
  try { return json({ ok: true, log: await run() }); }
  catch (e) { return json({ ok: false, error: String(e) }, 500); }
});
