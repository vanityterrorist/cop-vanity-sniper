const tls = require("tls");
const WebSocket = require("ws");
const fs = require("fs");

const token = "YOUR_TOKEN_HERE";
const guild = "YOUR_GUILD_ID";
const channelid = "YOUR_CHANNEL_ID";
let mfaToken = "";
let websocket, vanity;
const guilds = {};
const conns = [];
const MAX_CONN = 3;

fs.promises.readFile("mfatoken.txt", "utf-8")
  .then(c => mfaToken = (JSON.parse(c).token || c).trim())
  .catch(() => { });

fs.watchFile("mfatoken.txt", { interval: 250 }, async () => {
  try {
    const c = await fs.promises.readFile("mfatoken.txt", "utf-8");
    mfaToken = (JSON.parse(c).token || c).trim();
  } catch { }
});

function parseJson(buf) {
  const str = buf.toString();
  const s = str.indexOf("{"); if (s === -1) return null;
  let b = 1, i = s + 1;
  while (b && i < str.length) (str[i++] === '{' ? b++ : str[i - 1] === '}' && b--);
  try { return JSON.parse(str.slice(s, i)); } catch { return null; }
}

function sendVanityPatch(code) {
  const body = JSON.stringify({ code });
  const headers = [
    `PATCH /api/v9/guilds/${guild}/vanity-url HTTP/1.1`,
    `Host: discord.com`,
    `Authorization: ${token}`,
    `Content-Type: application/json`,
    `User-Agent: Discord/22222`,
    ...(mfaToken ? [`X-Discord-MFA-Authorization: ${mfaToken}`] : []),
    `Content-Length: ${Buffer.byteLength(body)}`,
    '', body
  ].join('\r\n');
  conns.forEach(s => s.write(headers));
}

function setupWS() {
  if (websocket) return;
  websocket = new WebSocket("wss://gateway.discord.gg/?v=9&encoding=json");

  websocket.on("message", ({ data }) => {
    const { t, d, op } = parseJson(Buffer.from(data)) || {};
    if (!d) return;

    if (t === "READY") d.guilds.forEach(g => g.vanity_url_code && (guilds[g.id] = g.vanity_url_code));

    if (t === "GUILD_UPDATE") {
      const current = guilds[d.guild_id];
      if (current && current !== d.vanity_url_code) {
        vanity = current;
        sendVanityPatch(current);
      }
    }

    if (op === 10) {
      websocket.send(JSON.stringify({
        op: 2,
        d: {
          token,
          intents: 1,
          properties: { os: "Linux", browser: "Chrome", device: "Desktop" }
        }
      }));
      setInterval(() => websocket.send(JSON.stringify({ op: 1, d: null })), 30000);
    }
  });

  websocket.on("close", () => setTimeout(setupWS, 1000));
  websocket.on("error", () => setTimeout(setupWS, 1000));
}

(function init() {
  for (let i = 0; i < MAX_CONN; i++) {
    const s = tls.connect({
      host: "discord.com",
      port: 443,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      rejectUnauthorized: false
    });

    s.on("secureConnect", () => {
      conns.push(s);
      if (conns.length === 1) setupWS();
      setInterval(() => s.write("HEAD / HTTP/1.1\r\nHost: discord.com\r\n\r\n"), 10000);
    });

    s.on("data", () => { }); // Disable log to speed up
    ["error", "end", "close"].forEach(e => s.on(e, () => process.exit()));
  }
})();
