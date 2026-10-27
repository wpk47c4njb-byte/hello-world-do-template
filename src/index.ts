/* Penalti online server: Cloudflare Worker + Durable Object + Telegram bot */
import { DurableObject } from "cloudflare:workers";

const MAX_PEERS = 40;
const MAX_MSG = 6000;

export class MyDurableObject extends DurableObject {
  mem: Map<string, any>;
  constructor(ctx: any, env: any) {
    super(ctx, env);
    this.mem = new Map();
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("WebSocket kerak", { status: 426 });
    const url = new URL(req.url);
    const peer = (url.searchParams.get("peer") || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24) || "p" + Math.random().toString(36).slice(2, 10);
    if (this.live().length >= MAX_PEERS) return new Response("Xona to'la", { status: 429 });
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ peer, presence: {} });
    const results = (await this.ctx.storage.get("results")) || [];
    server.send(JSON.stringify({ t: "hello", peer, results }));
    this.broadcastPeers();
    return new Response(null, { status: 101, webSocket: client });
  }

  live(): any[] {
    return this.ctx.getWebSockets().filter((ws: any) => {
      const a = ws.deserializeAttachment();
      return a && !a.gone && ws.readyState === 1;
    });
  }

  presenceOf(ws: any) {
    const a = ws.deserializeAttachment() || {};
    return this.mem.has(a.peer) ? this.mem.get(a.peer) : a.presence || {};
  }

  broadcastPeers() {
    const list = this.live().map((ws: any) => ({ peer: ws.deserializeAttachment().peer, presence: this.presenceOf(ws) }));
    const msg = JSON.stringify({ t: "peers", peers: list });
    for (const ws of this.live()) { try { ws.send(msg); } catch (e) {} }
  }

  async webSocketMessage(ws: any, data: any) {
    if (typeof data !== "string" || data.length > MAX_MSG) return;
    let m: any;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "presence" && m.p && typeof m.p === "object") {
      const a = ws.deserializeAttachment() || {};
      const s = JSON.stringify(m.p);
      if (s.length < 1800) { a.presence = m.p; this.mem.delete(a.peer); }
      else { a.presence = {}; this.mem.set(a.peer, m.p); }
      ws.serializeAttachment(a);
      this.broadcastPeers();
    } else if (m.t === "result" && m.r && typeof m.r === "object" && JSON.stringify(m.r).length < 600) {
      let list: any[] = (await this.ctx.storage.get("results")) || [];
      list = [m.r].concat(list.filter((x: any) => x && x.at !== m.r.at)).slice(0, 14);
      await this.ctx.storage.put("results", list);
      const msg = JSON.stringify({ t: "results", results: list });
      for (const s of this.live()) { try { s.send(msg); } catch (e) {} }
    } else if (m.t === "ping") {
      try { ws.send('{"t":"pong"}'); } catch (e) {}
    }
  }

  async webSocketClose(ws: any) {
    const a = ws.deserializeAttachment() || {};
    a.gone = true;
    try { ws.serializeAttachment(a); } catch (e) {}
    this.mem.delete(a.peer);
    try { ws.close(1000, "bye"); } catch (e) {}
    this.broadcastPeers();
  }

  async webSocketError(ws: any) {
    await this.webSocketClose(ws);
  }
}

const GAME_URL = "https://penalti-uz.pages.dev";

async function telegram(req: Request, env: any): Promise<Response> {
  const token = env.BOT_TOKEN || "";
  if (!token || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== token.replace(":", "")) return new Response("no", { status: 403 });
  let u: any;
  try { u = await req.json(); } catch (e) { return new Response("ok"); }
  const msg = u && u.message;
  if (msg && msg.chat && msg.chat.type === "private") {
    const name = (msg.from && msg.from.first_name) || "do'stim";
    const text = "⚽ Salom, " + name + "!\n\nPENALTI SERIYASI — top-5 liganing 22 jamoasi.\n5+5 zarba, durang bo'lsa hal qiluvchi zarbalar.\n\n🎯 Kompyuterga qarshi\n👥 Bitta telefonda 2 kishi\n🌍 Online duel — do'stingga kod yuborasan\n\nPastdagi tugmani bos 👇";
    await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: msg.chat.id, text, reply_markup: { inline_keyboard: [[{ text: "⚽ O'ynash", web_app: { url: GAME_URL } }]] } }),
    });
  }
  return new Response("ok");
}

export default {
  async fetch(req: Request, env: any): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const room = (url.searchParams.get("room") || "lobby").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "lobby";
      const stub = env.MY_DURABLE_OBJECT.get(env.MY_DURABLE_OBJECT.idFromName(room));
      return stub.fetch(req);
    }
    if (url.pathname === "/tg" && req.method === "POST") return telegram(req, env);
    return new Response("Penalti online server ishlayapti ✅", { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
