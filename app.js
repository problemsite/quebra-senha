/* Quebra-Senha — duelo 1v1 online (Firebase Realtime Database), modo local entre abas e treino contra o robô. */
(() => {
"use strict";
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEF_OPTS = { len: 12, rep: true, time: 0, last: true, first: "0" };
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ls = {
  get(k, d = null){ try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};

/* =====================================================================
   REDE — Firebase, abas do mesmo navegador, ou memória (treino)
   ===================================================================== */
function applyPatch(obj, patch){
  for(const [path, val] of Object.entries(patch)){
    const parts = path.split("/").filter(Boolean); let o = obj;
    for(let i = 0; i < parts.length - 1; i++){ if(o[parts[i]] == null || typeof o[parts[i]] !== "object") o[parts[i]] = {}; o = o[parts[i]]; }
    const last = parts[parts.length - 1];
    if(val === null) delete o[last]; else o[last] = JSON.parse(JSON.stringify(val));
  }
  return obj;
}
function localNet(){
  const ch = ("BroadcastChannel" in window) ? new BroadcastChannel("quebrasenha") : null;
  const subs = {}, key = c => "qs_room_" + c;
  const notify = c => (subs[c] || []).forEach(cb => cb(ls.get(key(c))));
  if(ch) ch.onmessage = e => notify(e.data);
  return {
    mode: "local",
    async get(c){ return ls.get(key(c)); },
    async create(c, d){ ls.set(key(c), d); notify(c); if(ch) ch.postMessage(c); },
    async update(c, p){ ls.set(key(c), applyPatch(ls.get(key(c)) || {}, p)); notify(c); if(ch) ch.postMessage(c); },
    subscribe(c, cb){ (subs[c] = subs[c] || []).push(cb); cb(ls.get(key(c))); return () => { subs[c] = (subs[c] || []).filter(x => x !== cb); }; },
    presence(){}
  };
}
function memNet(){
  const data = {}, subs = {};
  const clone = x => x ? JSON.parse(JSON.stringify(x)) : null;
  const fire = c => setTimeout(() => (subs[c] || []).forEach(cb => cb(clone(data[c]))), 0);
  return {
    mode: "solo",
    async get(c){ return clone(data[c]); },
    async create(c, d){ data[c] = clone(d); fire(c); },
    async update(c, p){ data[c] = applyPatch(data[c] || {}, p); fire(c); },
    subscribe(c, cb){ (subs[c] = subs[c] || []).push(cb); fire(c); return () => { subs[c] = []; }; },
    presence(){}
  };
}
function loadScript(src){ return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
async function firebaseNet(cfg){
  const V = "10.12.2";
  await loadScript(`https://www.gstatic.com/firebasejs/${V}/firebase-app-compat.js`);
  await loadScript(`https://www.gstatic.com/firebasejs/${V}/firebase-database-compat.js`);
  firebase.initializeApp(cfg);
  const db = firebase.database(), ref = c => db.ref("quebrasenha/rooms/" + c);
  return {
    mode: "online",
    async get(c){ return (await ref(c).get()).val(); },
    async create(c, d){ await ref(c).set(d); },
    async update(c, p){ await ref(c).update(p); },
    subscribe(c, cb){ const h = s => cb(s.val()); ref(c).on("value", h); return () => ref(c).off("value", h); },
    presence(c, seat){ const r = ref(c).child(`players/${seat}/online`);
      db.ref(".info/connected").on("value", s => { if(s.val()){ r.onDisconnect().set(false); r.set(true); } }); }
  };
}

/* =====================================================================
   SOM (sintetizado)
   ===================================================================== */
const Sound = (() => {
  let ac = null, on = ls.get("qs_sound", true);
  const ctx = () => { if(!ac){ try{ ac = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){} } if(ac && ac.state === "suspended") ac.resume(); return ac; };
  function tone(f, d = .12, type = "sine", vol = .12, delay = 0, to = null){
    if(!on) return; const a = ctx(); if(!a) return;
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if(to) o.frequency.exponentialRampToValueAtTime(to, t + d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + .05);
  }
  function noise(d = .15, vol = .1, delay = 0, hp = 800){
    if(!on) return; const a = ctx(); if(!a) return;
    const b = a.createBuffer(1, a.sampleRate * d, a.sampleRate), x = b.getChannelData(0);
    for(let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * (1 - i / x.length);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    f.type = "highpass"; f.frequency.value = hp; g.gain.value = vol; s.buffer = b;
    s.connect(f).connect(g).connect(a.destination); s.start(a.currentTime + delay);
  }
  return {
    get on(){ return on; }, toggle(){ on = !on; ls.set("qs_sound", on); return on; }, unlock: ctx,
    key(){ tone(1400, .04, "triangle", .05); noise(.025, .03, 0, 4000); },
    oppKey(){ tone(900, .03, "triangle", .035); noise(.02, .02, 0, 3500); },
    del(){ tone(500, .05, "triangle", .05, 0, 300); },
    deny(){ tone(220, .09, "square", .05); tone(180, .12, "square", .05, .08); },
    send(){ tone(500, .18, "sawtooth", .04, 0, 1400); noise(.18, .04, 0, 3000); },
    reveal(f, i){ const d = i * .08;
      if(f === "G"){ tone(1047, .22, "sine", .13, d); tone(1568, .2, "sine", .05, d + .02); }
      else if(f === "O") tone(660, .16, "triangle", .11, d);
      else { tone(170, .1, "sine", .1, d, 100); } },
    allFound(dl){ [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, .3, "triangle", .1, dl + i * .09)); },
    newGreen(dl){ [784, 988, 1175, 1568].forEach((f, i) => tone(f, .22, "sine", .11, dl + i * .07)); },
    near(dl){ for(let i = 0; i < 3; i++){ tone(880, .12, "square", .06, dl + i * .22); tone(660, .12, "square", .05, dl + .1 + i * .22); } },
    oppGreen(){ tone(330, .3, "sawtooth", .06, 0, 220); tone(311, .3, "sawtooth", .05, .05, 200); },
    alarm(){ for(let i = 0; i < 4; i++) tone(950, .18, "square", .06, i * .3, 600); },
    turn(){ tone(400, .25, "sine", .08, 0, 900); tone(900, .2, "sine", .06, .18); },
    tick(hi){ tone(hi ? 1500 : 1100, .04, "square", .04); },
    timeout(){ tone(300, .5, "sawtooth", .07, 0, 80); },
    lock(){ tone(200, .08, "square", .07); noise(.08, .06, .02, 1500); tone(1200, .12, "sine", .06, .1); },
    join(){ tone(660, .1, "sine", .08); tone(990, .16, "sine", .08, .09); },
    win(){ [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, .32, "triangle", .1, i * .11)); noise(.6, .04, .9, 4000); },
    lose(){ [440, 392, 349, 262].forEach((f, i) => tone(f, .45, "sawtooth", .06, i * .22, f * .97)); },
    lastChance(){ tone(220, 1.2, "sawtooth", .06, 0, 440); [880, 880, 880].forEach((f, i) => tone(f, .1, "square", .05, .6 + i * .15)); }
  };
})();

/* =====================================================================
   REGRAS
   verde = lugar certo · laranja = existe em outro lugar · vermelho = não existe (ou já contou todas as cópias)
   ===================================================================== */
function feedback(secret, guess){
  const L = secret.length, res = Array(L).fill("R"), cnt = {};
  for(let i = 0; i < L; i++){ if(guess[i] === secret[i]) res[i] = "G"; else cnt[secret[i]] = (cnt[secret[i]] || 0) + 1; }
  for(let i = 0; i < L; i++){ if(res[i] !== "G" && cnt[guess[i]] > 0){ res[i] = "O"; cnt[guess[i]]--; } }
  return res.join("");
}
const listOf = (room, pc) => { const o = room?.guesses?.[pc]; if(!o) return []; return Object.keys(o).map(Number).sort((a, b) => a - b).map(k => o[k]); };
const revealed = list => list.filter(e => e.f && !e.s);
const tries = list => list.filter(e => !e.s).length;
function knowledge(list, L, rep){
  const fixed = Array(L).fill(null), ban = Array.from({ length: L }, () => new Set());
  const mn = {}, ex = {};
  for(const a of revealed(list)){
    const seen = {}, hasR = {};
    for(let i = 0; i < L; i++){
      const c = a.g[i], f = a.f[i];
      if(f === "G") fixed[i] = c; else ban[i].add(c);
      if(f !== "R") seen[c] = (seen[c] || 0) + 1; else hasR[c] = true;
    }
    for(const c of new Set(a.g)){ const k = seen[c] || 0; if(k) mn[c] = Math.max(mn[c] || 0, k); if(hasR[c]) ex[c] = k; }
  }
  if(!rep) fixed.forEach((c, i) => { if(c) ban.forEach((b, j) => { if(j !== i) b.add(c); }); });
  const dead = c => ex[c] === 0;
  const state = {};
  CHARS.forEach(c => {
    if(dead(c)) state[c] = "R";
    else if(mn[c]){ const placed = fixed.filter(x => x === c).length; state[c] = (ex[c] != null && placed >= ex[c]) || (!rep && placed) ? "G" : "O"; }
    else state[c] = "";
  });
  // caractere já completo (todas as cópias no lugar) não cabe em outras posições
  CHARS.forEach(c => { if(state[c] === "G" && ex[c] != null) ban.forEach((b, i) => { if(fixed[i] !== c) b.add(c); }); });
  const greens = fixed.filter(Boolean).length;
  const found = Math.min(L, Object.values(mn).reduce((a, b) => a + b, 0));
  const left = ban.map((b, i) => fixed[i] ? 1 : CHARS.filter(c => !dead(c) && !b.has(c)).length);
  return { fixed, ban, greens, left, state, found, mn, ex, dead };
}
function randomPw(L, rep){
  if(rep) return Array.from({ length: L }, () => CHARS[Math.floor(Math.random() * CHARS.length)]);
  const a = [...CHARS]; for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, L);
}
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");

/* =====================================================================
   ESTADO
   ===================================================================== */
const S = {
  net: null, realNet: null, solo: false, code: null, seat: null, name: ls.get("qs_name", ""), room: null, prev: null, unsub: null,
  screen: null, draft: [], cur: 0, draftKey: null, hidePw: false, menu: false,
  timer: { key: null, left: 0, id: null }, shownEnd: null, animDone: {}, popGreens: null, popDef: null
};
const me = () => S.seat, opp = () => 1 - S.seat;
const P = i => S.room?.players?.[i] || null;
const nameOf = i => P(i)?.name || (i === 0 ? "Player 1" : "Player 2");
const opts = () => Object.assign({}, DEF_OPTS, S.room?.opts || {});
const LEN = () => opts().len;
const secretKey = () => `qs_secret_${S.code}_${S.room?.round || 0}_${S.seat}`;
const mySecret = () => S.solo ? S.soloSecret : ls.get(secretKey());
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/* =====================================================================
   CENÁRIO: quarto + notebook
   ===================================================================== */
function roomSVG(){
  let city = "", lit = "";
  const rnd = (a, b) => a + Math.random() * (b - a);
  let x = 150;
  while(x < 560){ const w = rnd(30, 70), h = rnd(80, 260); city += `<rect x="${x.toFixed(0)}" y="${(560 - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="#071019"/>`;
    for(let yy = 560 - h + 12; yy < 548; yy += 18) for(let xx = x + 6; xx < x + w - 8; xx += 13) if(Math.random() < .28) lit += `<rect x="${xx.toFixed(0)}" y="${yy.toFixed(0)}" width="5" height="7" fill="${Math.random() < .7 ? "#ffd27a" : "#8ff0ff"}" opacity="${rnd(.35, .9).toFixed(2)}"/>`;
    x += w + rnd(2, 10); }
  const books = [["#2fd8f2",26,92],["#ff9a3d",20,80],["#e8eef2",30,96],["#3a5f8a",22,86],["#22d38a",18,74],["#8a3a5f",28,94],["#e8eef2",16,70]];
  let bx = 1400, bk = "";
  books.forEach(([c, w, h]) => { bk += `<rect x="${bx}" y="${420 - h}" width="${w}" height="${h}" rx="3" fill="${c}" opacity=".85"/>`; bx += w + 4; });
  return `<svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f2232"/><stop offset=".75" stop-color="#0b1824"/><stop offset="1" stop-color="#08121a"/></linearGradient>
    <linearGradient id="led" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2fd8f2" stop-opacity=".35"/><stop offset="1" stop-color="#2fd8f2" stop-opacity="0"/></linearGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1a33"/><stop offset="1" stop-color="#1b3550"/></linearGradient>
    <linearGradient id="desk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a3426"/><stop offset=".08" stop-color="#3a281d"/><stop offset="1" stop-color="#1b120c"/></linearGradient>
    <radialGradient id="lamp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb76b" stop-opacity=".35"/><stop offset="1" stop-color="#ffb76b" stop-opacity="0"/></radialGradient>
    <radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#2fd8f2" stop-opacity=".22"/><stop offset="1" stop-color="#2fd8f2" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#wall)"/>
  <rect x="0" y="0" width="1920" height="300" fill="url(#led)"/>
  <rect x="0" y="28" width="1920" height="7" fill="#7ff0ff"/>
  <rect x="130" y="150" width="450" height="420" rx="10" fill="url(#sky)"/>
  <circle cx="470" cy="240" r="34" fill="#e9f4ff" opacity=".9"/><circle cx="470" cy="240" r="80" fill="#e9f4ff" opacity=".06"/>
  ${Array.from({ length: 26 }, () => `<circle cx="${rnd(140, 570).toFixed(0)}" cy="${rnd(160, 380).toFixed(0)}" r="${rnd(.8, 2).toFixed(1)}" fill="#fff" opacity="${rnd(.3, .9).toFixed(2)}"/>`).join("")}
  ${city}${lit}
  <rect x="130" y="150" width="450" height="420" rx="10" fill="none" stroke="#1d2f3d" stroke-width="18"/>
  <rect x="346" y="150" width="14" height="420" fill="#1d2f3d"/><rect x="130" y="352" width="450" height="12" fill="#1d2f3d"/>
  <path d="M90 120 Q140 360 110 610 L60 610 L60 120 Z" fill="#14324a"/><path d="M620 120 Q570 360 600 610 L650 610 L650 120 Z" fill="#14324a"/>
  <rect x="60" y="112" width="590" height="12" rx="6" fill="#26394a"/>
  <rect x="1460" y="110" width="250" height="170" rx="8" fill="#14b9d6"/>
  <path d="M1585 130 L1640 162 L1640 226 L1585 258 L1530 226 L1530 162 Z" fill="#fff" stroke="#000" stroke-width="7" stroke-linejoin="round"/>
  <rect x="1370" y="420" width="430" height="16" rx="4" fill="#2a3a46"/>${bk}
  <path d="M1690 420 L1690 396 L1712 384 L1734 396 L1734 420 Z" fill="#fff" stroke="#000" stroke-width="4"/>
  <rect x="1752" y="380" width="30" height="40" rx="5" fill="#2a4b3a"/><circle cx="1767" cy="368" r="22" fill="#2f7a4f"/>
  <circle cx="1720" cy="700" r="380" fill="url(#lamp)"/>
  <circle cx="960" cy="600" r="620" fill="url(#glow)"/>
  <rect x="0" y="830" width="1920" height="250" fill="url(#desk)"/>
  <rect x="0" y="826" width="1920" height="6" fill="#6b4a35" opacity=".8"/>
  ${Array.from({ length: 7 }, (_, i) => `<path d="M0 ${870 + i * 30} Q960 ${(860 + i * 30 + rnd(-8, 8)).toFixed(0)} 1920 ${872 + i * 30}" stroke="#000" stroke-opacity=".12" stroke-width="2" fill="none"/>`).join("")}
  <rect x="356" y="740" width="70" height="92" rx="10" fill="#e8eef2"/><path d="M426 760 q32 6 0 46" stroke="#e8eef2" stroke-width="10" fill="none"/>
  <path d="M378 724 q-10 -20 6 -36 M398 724 q-10 -22 6 -40" stroke="#fff" stroke-opacity=".18" stroke-width="5" fill="none"/>
  <rect x="1490" y="850" width="150" height="38" rx="8" fill="#111821" transform="rotate(-8 1565 869)"/>
  </svg>`;
}
const ICON = {
  sound: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>`,
  mute: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>`
};
const hexSVG = (fill, stroke = "rgba(255,255,255,.9)", sw = 4) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 4 L90 27 L90 73 L50 96 L10 73 L10 27 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/></svg>`;
const pColor = i => i === 0 ? "#22c7e6" : "#ff9a3d";

const app = $("#app");
function shell(){
  app.innerHTML = `<div id="room">${roomSVG()}</div>
  <div class="tools"><button class="icon-btn" data-act="sound" aria-label="Som" title="Som">${Sound.on ? ICON.sound : ICON.mute}</button>
    <button class="icon-btn" data-act="menu" aria-label="Opções" title="Opções">${ICON.gear}</button></div>
  <div class="menu hidden" id="menu"></div>
  <div class="nb" id="nb"><div class="lid"><div class="screen"><div id="scr"></div></div></div><div class="hinge"></div><div class="deck"></div><div class="lip"></div></div>`;
}
function renderMenu(){
  $("#menu").innerHTML = S.code ? `<button class="btn soft" data-act="leave">${S.solo ? "Sair do treino" : "Sair da sala"}</button>`
    : `<div class="note">Entre numa sala para ver mais opções.</div>`;
}
const scr = () => $("#scr");
function go(s){ S.screen = s; $("#nb").className = "nb"; }

/* =====================================================================
   TELAS: início, lobby, senha
   ===================================================================== */
function viewHome(err = ""){
  go("home");
  const sess = ls.get("qs_session"), qsCode = new URLSearchParams(location.search).get("sala") || "";
  scr().innerHTML = `<div class="center">
    <div style="display:flex;flex-direction:column;align-items:center;gap:.6em">
      <div class="hexav" style="width:4.4em;height:4.4em">${hexSVG("#ffffff","#0a1c28",5)}</div>
      <div class="eyebrow">Duelo 1v1</div>
      <h1 class="logo">Quebra-<span>Senha</span></h1>
    </div>
    <div class="panel home-card">
      <div class="field"><label for="nm">Seu nome</label><input id="nm" class="input" maxlength="16" placeholder="Ex.: Problems" value="${esc(S.name)}"></div>
      <button class="btn cyan" data-act="create">Criar sala</button>
      <div class="row2"><input id="cd" class="input code" maxlength="4" placeholder="CÓDIGO" value="${esc(qsCode)}" aria-label="Código da sala"><button class="btn orange" data-act="join">Entrar</button></div>
      <button class="btn soft" data-act="solo">Treinar sozinho contra o robô</button>
      ${sess ? `<button class="btn soft" data-act="rejoin">Voltar para a sala ${esc(sess.code)}</button>` : ""}
      <div class="err" id="err">${esc(err)}</div>
    </div>
    <div class="note">${S.net?.mode === "online" ? "Online · Sem login" : "Modo local: sem Firebase, salas só entre abas deste navegador."}</div>
  </div>`;
  const nm = $("#nm"); nm.oninput = () => { S.name = nm.value.trim(); ls.set("qs_name", S.name); };
  const cd = $("#cd"); cd.oninput = () => cd.value = cd.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  cd.onkeydown = e => { if(e.key === "Enter") join(); };
}
function playerCard(i){
  const p = P(i);
  return `<div class="panel pcard p${i+1} ${i === me() ? "me" : ""}">
    <div class="hexav">${hexSVG(pColor(i))}<b>${p ? esc(p.name[0]?.toUpperCase() || "?") : "+"}</b></div>
    <h3>${esc(p ? p.name : "Player " + (i+1))}</h3>
    <div class="st">${p ? (p.online === false ? "Desconectado" : "Conectado") : "Vaga aberta"}</div>
    <span class="chip ${p ? "ok" : ""}">${p ? "pronto" : "aguardando jogador"}</span></div>`;
}
function viewLobby(){
  go("lobby");
  const o = opts(), host = me() === 0, full = !!P(1);
  const seg = (k, vals) => `<div class="seg">${vals.map(([v, t]) => `<button data-opt="${k}" data-v="${v}" class="${String(o[k]) === String(v) ? "on" : ""}" ${host ? "" : "disabled"}>${t}</button>`).join("")}</div>`;
  scr().innerHTML = `<div class="center">
    <div style="text-align:center"><div class="eyebrow">Lobby</div><h1 class="logo" style="font-size:3em">Quebra-<span>Senha</span></h1></div>
    <div class="lobby">${playerCard(0)}<div class="vs">VS</div>${playerCard(1)}</div>
    <div class="lobby-foot">
      ${S.solo ? `<div class="panel codebox"><div class="eyebrow">Modo treino</div><div class="code" style="font-size:1.8em">SOLO</div></div>`
        : `<div class="panel codebox"><div class="eyebrow">Código da sala</div><div class="code">${esc(S.code)}</div>
           <button class="btn soft" data-act="copy" style="padding:.5em 1em;font-size:.8em">Copiar link</button></div>`}
      <div class="panel opts">
        <div class="field"><label>Tamanho da senha</label>${seg("len", [[8,"8"],[10,"10"],[12,"12"]])}</div>
        <div class="field"><label>Tempo por jogada</label>${seg("time", [[0,"Livre"],[60,"60s"],[90,"90s"],[120,"120s"]])}</div>
        <div class="field"><label>Quem começa</label>${seg("first", [["0", esc(nameOf(0)).slice(0, 9)],["1", esc(nameOf(1)).slice(0, 9)],["r","Sorteio"]])}</div>
        <div class="field"><label>Repetir caracteres</label>${seg("rep", [[true,"Sim"],[false,"Não"]])}</div>
      </div>
    </div>
    ${host ? `<button class="btn cyan" data-act="start" ${full ? "" : "disabled"} style="min-width:16em">${full ? "Começar partida" : "Esperando o Player 2"}</button>`
      : `<div class="waiting" style="color:var(--ink-2)">Esperando ${esc(nameOf(0))} começar <span class="dots"><i></i><i></i><i></i></span></div>`}
  </div>`;
}
function viewSetup(){
  go("setup");
  const L = LEN(), sec = mySecret(), locked = !!P(me())?.ready && sec, rep = opts().rep;
  if(S.draft.length !== L) S.draft = Array(L).fill("");
  scr().innerHTML = `<div class="center"><div class="setup">
    <div class="eyebrow">Rodada ${S.room.round}</div>
    <h2>${locked ? "PC trancado" : "Crie a senha do seu PC"}</h2>
    <p>${locked ? `Esperando ${esc(nameOf(opp()))} trancar o dele.` : `${L} caracteres, letras e números${rep ? ", pode repetir" : ", sem repetir"}. A senha fica só neste computador.`}</p>
    ${locked ? `<div class="row">${sec.map(c => `<div class="tile G"><b>${esc(c)}</b></div>`).join("")}</div>`
      : `<div class="row" id="entry">${S.draft.map((c, i) => `<button class="slot ${i === S.cur ? "cur" : ""}" data-slot="${i}" aria-label="Posição ${i+1}"><b>${esc(c)}</b></button>`).join("")}</div>
         <div class="kb">${CHARS.map(c => `<button class="key ${!rep && S.draft.includes(c) ? "no" : ""}" data-key="${c}"><span>${c}</span></button>`).join("")}</div>
         <div class="actions"><button class="btn soft" data-act="random">Sortear</button><button class="btn cyan" data-act="lockpw" ${S.draft.every(Boolean) ? "" : "disabled"}>Trancar senha</button></div>`}
    <div class="statusrow">${[0,1].map(i => `<span class="chip ${P(i)?.ready ? "ok" : ""}">${esc(nameOf(i))}: ${P(i)?.ready ? "trancado" : "criando…"}</span>`).join("")}</div>
  </div></div>`;
}

/* =====================================================================
   PARTIDA
   ===================================================================== */
function viewGame(){
  go("game");
  scr().innerHTML = `<div class="gtop"><div class="mypw" id="mypw"></div><div class="turn" id="turn"></div></div>
    <div class="gmain" id="gmain"></div>
    <div class="gfoot" id="gfoot"></div>`;
  updateGame();
}
function bars(n, L){ return `<span class="bars">${Array.from({ length: L }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`; }
function rowTiles(g, f, cls = "", animKey = null){
  const anim = animKey && !S.animDone[animKey];
  if(anim) S.animDone[animKey] = true;
  return `<div class="row ${cls}">${[...g].map((c, i) => `<div class="tile ${f ? f[i] : "scan"} ${anim ? "flip" : ""}" style="${anim ? `animation-delay:${i * 80}ms` : ""}"><b>${esc(c)}</b></div>`).join("")}</div>`;
}
function lastBlock(list, pc, who){
  const n = list.length;
  if(!n) return `<div class="blk"><div class="lbl">Última tentativa</div><div class="empty-last">Nenhuma tentativa ainda</div></div>`;
  const e = list[n - 1];
  if(e.s) return `<div class="blk"><div class="lbl">Tentativa ${n} · ${who}</div><div class="empty-last">tempo esgotado</div></div>`;
  return `<div class="blk"><div class="lbl">Tentativa ${tries(list)} · ${who}</div>${rowTiles(e.g, e.f, "last", e.f ? `${S.room.round}:${pc}:${n - 1}` : null)}</div>`;
}
function updateGame(){
  const room = S.room, L = LEN(), rep = opts().rep;
  const mine = room.state === "play" && room.turn === me();
  const atk = listOf(room, opp()), K = knowledge(atk, L, rep);
  const def = listOf(room, me()), KD = knowledge(def, L, rep);
  const sec = mySecret() || [];
  const lastC = room.lc != null, over = room.state === "over";
  const won = over && (room.winner === "draw" || Number(room.winner) === me());

  $("#nb").className = "nb" + (mine ? " live" : "") + (!mine && !over && KD.greens >= L - 1 ? " danger" : "") + (won ? " unlocked" : "");

  $("#mypw").innerHTML = `Sua senha: <span class="pw ${S.hidePw ? "blur" : ""}">${sec.map((c, i) => KD.fixed[i] ? `<i>${esc(c)}</i>` : esc(c)).join("")}</span>
    <button class="eye" data-act="eye">${S.hidePw ? "MOSTRAR" : "ESCONDER"}</button>`;
  const pill = over ? `<span class="turnpill">Fim de partida</span>`
    : `<span class="turnpill ${lastC ? "last" : mine ? "mine" : "opp"}">${lastC ? "Última chance · " : ""}${mine ? "Sua vez" : "Vez de " + esc(nameOf(room.turn))}</span>`;
  $("#turn").innerHTML = pill + (opts().time && !over ? `<span class="tm" id="tm"></span>` : "");
  renderTimer();

  $("#gfoot").innerHTML = `<div class="prog me"><span class="nm">${esc(nameOf(me()))}</span>${bars(K.greens, L)}<span class="n">${K.greens}/${L}</span></div>
    <div class="prog opp"><span class="n">${KD.greens}/${L}</span>${bars(KD.greens, L)}<span class="nm">${esc(nameOf(opp()))}</span></div>`;

  const main = $("#gmain");
  if(mine || over){
    const pending = atk.length && !atk[atk.length - 1].f;
    const tk = room.round + ":" + atk.length;
    if(mine && !pending && S.draftKey !== tk){ S.draftKey = tk; S.draft = Array(L).fill(""); prefill(K); pushTyping(); }
    const pops = S.popGreens; S.popGreens = null;
    let bottom = "";
    if(over) bottom = `<div class="actions"><button class="btn cyan" data-act="showend">Ver resultado</button></div>`;
    else if(pending) bottom = `<div class="hintrow"><span class="waiting" style="color:var(--ink-2)">Verificando <span class="dots"><i></i><i></i><i></i></span></span></div>`;
    else {
      const curBan = K.ban[S.cur] || new Set(), bad = S.draft.some((c, i) => c && !K.fixed[i] && (K.ban[i].has(c) || K.dead(c)));
      bottom = `<div class="row" id="entry">${S.draft.map((c, i) => {
          let cls = "slot"; if(K.fixed[i]) cls += " lock"; else if(i === S.cur) cls += " cur";
          if(c && !K.fixed[i] && (K.ban[i].has(c) || K.dead(c))) cls += " bad";
          return `<button class="${cls}" data-slot="${i}" aria-label="Posição ${i+1}"><b>${esc(c)}</b></button>`;
        }).join("")}</div>
        <div class="kb">${CHARS.map(c => { const off = curBan.has(c) || K.dead(c); return `<button class="key ${K.state[c]} ${off ? "no" : ""}" data-key="${c}" ${off ? "disabled" : ""}><span>${c}</span></button>`; }).join("")}</div>
        <div class="hintrow"><span class="hint ${bad ? "warn" : ""}">${bad ? "Tem caractere que não pode ficar nessa posição."
          : `Posição <b>${S.cur + 1}</b> · ${K.left[S.cur]} possíveis`}</span>
          <button class="btn cyan" data-act="send" ${S.draft.every(Boolean) ? "" : "disabled"}>Testar senha ⏎</button></div>`;
    }
    main.innerHTML = `<div class="ghead">Invadindo o PC de <b>${esc(nameOf(opp()))}</b></div>
      <div class="row big">${Array.from({ length: L }, (_, i) => K.fixed[i]
        ? `<div class="tile G ${pops && pops.includes(i) ? "pop" : ""}"><b>${esc(K.fixed[i])}</b></div>`
        : `<div class="tile"><b>?</b><small>${K.left[i]}</small></div>`).join("")}</div>
      ${lastBlock(atk, opp(), "você")}
      ${bottom}`;
  } else {
    const pending = def.length && !def[def.length - 1].f;
    const typing = (room.typing?.[opp()] || "").padEnd(L, ".");
    const tcur = typing.indexOf(".");
    const pops = S.popDef; S.popDef = null;
    main.innerHTML = `<div class="ghead def"><b>${esc(nameOf(opp()))}</b> está invadindo seu PC</div>
      <div class="row big">${sec.map((c, i) => `<div class="tile mine ${KD.fixed[i] ? "G" : ""} ${pops && pops.includes(i) ? "pop" : ""}"><b>${esc(c)}</b></div>`).join("")}</div>
      ${lastBlock(def, me(), esc(nameOf(opp())))}
      <div class="blk"><div class="lbl">Tela de ${esc(nameOf(opp()))}</div>
        <div class="row">${[...typing].slice(0, L).map((c, i) => `<div class="slot ghost ${KD.fixed[i] ? "lock" : ""} ${!pending && i === tcur ? "cur" : ""} ${c !== "." && !KD.fixed[i] ? "typed" : ""}" style="${KD.fixed[i] ? "background:linear-gradient(160deg,#ff6d7f,#d93349);color:#fff" : ""}"><b>${c === "." ? "" : esc(c)}</b></div>`).join("")}</div></div>
      <div class="hintrow"><span class="waiting">${pending ? "Verificando" : `${esc(nameOf(opp()))} está digitando`} <span class="dots"><i></i><i></i><i></i></span></span></div>`;
  }
  let dl = $(".danger-loop");
  if(!over && KD.greens >= L - 1){ if(!dl){ dl = document.createElement("div"); dl.className = "danger-loop"; document.body.appendChild(dl); } }
  else if(dl) dl.remove();
}
function prefill(K){
  K = K || knowledge(listOf(S.room, opp()), LEN(), opts().rep);
  for(let i = 0; i < LEN(); i++) if(K.fixed[i]) S.draft[i] = K.fixed[i];
  const f = S.draft.findIndex((c, i) => !K.fixed[i]); S.cur = f < 0 ? 0 : f;
}
let typingT = null;
function pushTyping(){
  if(!S.code || S.room?.state !== "play" || S.room.turn !== me()) return;
  clearTimeout(typingT);
  typingT = setTimeout(() => S.net.update(S.code, { [`typing/${me()}`]: S.draft.map(c => c || ".").join("") }), S.net.mode === "online" ? 60 : 0);
}

/* ---------- fim ---------- */
function showEnd(){
  const room = S.room, w = room.winner, L = LEN();
  const res = w === "draw" ? "draw" : (Number(w) === me() ? "win" : "lose");
  const title = { win: "Acesso liberado!", lose: "Seu PC foi invadido", draw: "Empate!" }[res];
  const sub = res === "draw" ? "Os dois quebraram a senha na mesma rodada."
    : res === "win" ? `Você quebrou a senha de ${esc(nameOf(opp()))} em ${plural(tries(listOf(room, opp())), "tentativa")}.`
    : `${esc(nameOf(opp()))} quebrou sua senha em ${plural(tries(listOf(room, me())), "tentativa")}.`;
  const pw = i => room.reveal?.[i] ? [...room.reveal[i]] : Array(L).fill("•");
  let ov = $(".endov"); if(!ov){ ov = document.createElement("div"); ov.className = "endov"; $(".screen").appendChild(ov); }
  ov.innerHTML = `<div class="endcard ${res}">
    <div class="eyebrow">${res === "win" ? "Vitória" : res === "lose" ? "Derrota" : "Rodada " + room.round}</div>
    <h1>${title}</h1><p>${sub}</p>
    ${[0,1].map(i => `<div class="blk"><div class="lbl">Senha de ${esc(nameOf(i))}</div><div class="row">${pw(i).map((c, k) => `<div class="tile G flip" style="animation-delay:${k * 70}ms"><b>${esc(c)}</b></div>`).join("")}</div></div>`).join("")}
    <div class="actions">${me() === 0 ? `<button class="btn cyan" data-act="rematch">Revanche</button>` : `<span class="note">Esperando ${esc(nameOf(0))} pedir revanche</span>`}
      <button class="btn soft" data-act="closeend">Ver tabuleiro</button><button class="btn soft" data-act="leave">Sair</button></div>
  </div>`;
}

/* =====================================================================
   EFEITOS
   ===================================================================== */
function burst(text, color = "cyan", small = "", delay = 0){
  setTimeout(() => { const fx = $("#fx"); fx.innerHTML = ""; const d = document.createElement("div"); d.className = "burst " + color;
    d.innerHTML = text + (small ? `<small>${small}</small>` : ""); fx.appendChild(d); setTimeout(() => d.remove(), 1700); }, delay);
}
function vignette(color, delay = 0){ setTimeout(() => { const v = document.createElement("div"); v.className = "vignette " + color; document.body.appendChild(v); setTimeout(() => v.remove(), 1500); }, delay); }
function sweep(){ const v = document.createElement("div"); v.className = "sweep"; document.body.appendChild(v); setTimeout(() => v.remove(), 1000); }
function confetti(){
  const cv = $("#confetti"), cx = cv.getContext("2d"); cv.width = innerWidth; cv.height = innerHeight;
  const cols = ["#2fd8f2", "#22d38a", "#ffffff", "#ff9a3d", "#8ff0ff"];
  const ps = Array.from({ length: 170 }, () => ({ x: innerWidth / 2 + (Math.random() - .5) * 240, y: innerHeight * .45, vx: (Math.random() - .5) * 16, vy: -Math.random() * 16 - 4, r: 6 + Math.random() * 9, a: Math.random() * 6, va: (Math.random() - .5) * .3, c: cols[Math.floor(Math.random() * cols.length)] }));
  let t = 0;
  (function f(){ cx.clearRect(0, 0, cv.width, cv.height); t++;
    ps.forEach(p => { p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.a); cx.fillStyle = p.c; cx.globalAlpha = Math.max(0, 1 - t / 220);
      cx.beginPath(); for(let k = 0; k < 6; k++){ const an = Math.PI / 3 * k; cx.lineTo(Math.cos(an) * p.r, Math.sin(an) * p.r); } cx.fill(); cx.restore(); });
    if(t < 220) requestAnimationFrame(f); else cx.clearRect(0, 0, cv.width, cv.height); })();
}

/* ---------- momentos importantes ---------- */
function events(prev, room){
  if(!prev || prev.round !== room.round || (room.state !== "play" && room.state !== "over")) return;
  const L = Object.assign({}, DEF_OPTS, room.opts).len, rep = Object.assign({}, DEF_OPTS, room.opts).rep;
  const pa = listOf(prev, opp()), na = listOf(room, opp());
  if(revealed(na).length > revealed(pa).length){
    const e = revealed(na).slice(-1)[0], K0 = knowledge(pa, L, rep), K1 = knowledge(na, L, rep);
    [...e.f].forEach((f, i) => Sound.reveal(f, i));
    const dl = L * .08 + .15, gained = K1.greens - K0.greens;
    S.popGreens = K1.fixed.map((c, i) => c && !K0.fixed[i] ? i : -1).filter(i => i >= 0);
    if(!/^G+$/.test(e.f)){
      if(K1.found === L && K0.found < L && K1.greens < L - 1){ Sound.allFound(dl); burst("Todos encontrados!", "cyan", "agora é só acertar a ordem", dl * 1000); vignette("green", dl * 1000); }
      else if(K1.greens === L - 1 && K0.greens < L - 1){ Sound.near(dl); burst("Falta 1!", "orange", "só mais um caractere", dl * 1000); vignette("orange", dl * 1000); }
      else if(gained >= 3){ Sound.newGreen(dl); burst(`+${gained} verdes!`, "green", "", dl * 1000); vignette("green", dl * 1000); }
      else if(gained > 0){ Sound.newGreen(dl); burst(gained > 1 ? `+${gained} verdes` : "Novo verde!", "green", "", dl * 1000); }
      else if(!e.f.includes("O")) burst("Nenhum acerto", "red", "", dl * 1000);
    }
  }
  const pd = listOf(prev, me()), nd = listOf(room, me());
  if(revealed(nd).length > revealed(pd).length){
    const K0 = knowledge(pd, L, rep), K1 = knowledge(nd, L, rep);
    S.popDef = K1.fixed.map((c, i) => c && !K0.fixed[i] ? i : -1).filter(i => i >= 0);
    if(K1.greens > K0.greens && K1.greens < L) setTimeout(() => {
      if(K1.greens >= L - 1){ Sound.alarm(); burst("Alerta!", "red", `${esc(nameOf(opp()))} está a 1 caractere`); vignette("red"); }
      else Sound.oppGreen();
    }, 300);
  }
  const pt = (prev.typing?.[opp()] || "").replace(/\./g, "").length, nt = (room.typing?.[opp()] || "").replace(/\./g, "").length;
  if(room.turn === opp() && nt > pt) Sound.oppKey();
  if(prev.lc == null && room.lc != null && room.state === "play"){
    setTimeout(() => { Sound.lastChance(); vignette("orange");
      if(room.turn === me()) burst("Última chance!", "orange", `${esc(nameOf(opp()))} acertou. Acerte agora para empatar.`);
      else { burst("Senha quebrada!", "green", `${esc(nameOf(opp()))} ainda tem uma chance de empatar`); confetti(); } }, 1200);
    return;
  }
  if(room.state === "play" && prev.turn !== room.turn && room.turn === me())
    setTimeout(() => { Sound.turn(); sweep(); burst("Sua vez", "cyan"); }, prev.state === "play" ? 1500 : 200);
}

/* =====================================================================
   SINCRONIZAÇÃO
   ===================================================================== */
function onRoom(room){
  if(!room){ if(S.code){ ls.del("qs_session"); cleanupRoom(); S.code = null; viewHome("A sala não existe mais."); } return; }
  const prev = S.prev; S.room = room; S.prev = JSON.parse(JSON.stringify(room));
  if(prev && prev.players && !prev.players[1] && room.players?.[1]) Sound.join();
  if(room.state === "play") resolvePending(room);
  if(room.state === "setup" && me() === 0 && P(0)?.ready && P(1)?.ready) S.net.update(S.code, { state: "play", turn: Number(room.first) });
  if(room.state === "over" && !room.reveal?.[me()] && mySecret()) S.net.update(S.code, { [`reveal/${me()}`]: mySecret().join("") });

  const want = { lobby: "lobby", setup: "setup", play: "game", over: "game" }[room.state];
  const newRound = prev && prev.round !== room.round;
  if(want === "setup" && (S.screen !== "setup" || newRound)){ S.draft = Array(LEN()).fill(""); S.cur = 0; }
  if(newRound){ S.animDone = {}; S.draftKey = null; }
  events(prev, room);
  if(want !== S.screen || newRound){
    $(".endov")?.remove();
    ({ lobby: viewLobby, setup: viewSetup, game: viewGame })[want]();
    if(want === "game" && prev?.state === "setup") setTimeout(() => { sweep(); Sound.turn(); burst(room.turn === me() ? "Você começa" : `${esc(nameOf(room.turn))} começa`, "cyan", "Que comece a invasão"); }, 300);
  } else ({ lobby: viewLobby, setup: viewSetup, game: updateGame })[want]();
  syncTimer();
  if(S.solo) Bot.step(room);

  if(room.state === "over"){
    const key = room.round + ":" + JSON.stringify(room.reveal || {});
    if(S.shownEnd !== key){
      const first = !S.shownEnd || !S.shownEnd.startsWith(room.round + ":");
      S.shownEnd = key;
      const res = room.winner === "draw" ? "draw" : (Number(room.winner) === me() ? "win" : "lose");
      if(first) setTimeout(() => {
        if(res === "win"){ Sound.win(); confetti(); vignette("green"); } else if(res === "lose"){ Sound.lose(); vignette("red"); } else { Sound.win(); confetti(); }
        if(S.room?.state === "over") showEnd();
      }, 1500);
      else if($(".endov")) showEnd();
    }
  }
}
function resolvePending(room, def = me(), sec = mySecret()){
  const list = listOf(room, def); if(!list.length || !sec) return;
  const n = list.length - 1, e = list[n]; if(e.f) return;
  const attacker = 1 - def, first = Number(room.first), second = 1 - first, patch = {};
  let solved = false;
  if(e.s) patch[`guesses/${def}/${n}/f`] = "-";
  else { const fb = feedback(sec, [...e.g]); patch[`guesses/${def}/${n}/f`] = fb; solved = /^G+$/.test(fb); }
  patch[`typing/${attacker}`] = null;
  const lc = room.lc;
  if(solved){
    if(attacker === first && Object.assign({}, DEF_OPTS, room.opts).last && lc == null){ patch.lc = attacker; patch.turn = second; }
    else { patch.state = "over"; patch.winner = lc != null ? "draw" : attacker; patch.turn = null; }
  } else if(lc != null && attacker === second){ patch.state = "over"; patch.winner = lc; patch.turn = null; }
  else patch.turn = 1 - attacker;
  S.net.update(S.code, patch);
}

/* ---------- cronômetro ---------- */
function syncTimer(){
  const room = S.room, t = opts().time;
  const key = room && room.state === "play" && t ? room.round + ":" + room.turn + ":" + listOf(room, 1 - room.turn).length : null;
  if(key === S.timer.key) return;
  clearInterval(S.timer.id); S.timer.key = key;
  if(!key) return renderTimer();
  S.timer.left = t; renderTimer();
  S.timer.id = setInterval(() => {
    S.timer.left--; renderTimer();
    if(S.room.turn === me()){
      if(S.timer.left <= 10 && S.timer.left > 0) Sound.tick(S.timer.left <= 5);
      if(S.timer.left <= 0){ clearInterval(S.timer.id); Sound.timeout(); burst("Tempo esgotado", "red");
        S.net.update(S.code, { [`guesses/${opp()}/${listOf(S.room, opp()).length}`]: { g: "", f: "", s: true } }); }
    }
    if(S.timer.left <= 0) clearInterval(S.timer.id);
  }, 1000);
}
function renderTimer(){
  const el = $("#tm"); if(!el) return; const s = Math.max(0, S.timer.left);
  el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  el.className = "tm" + (s <= 10 ? " crit" : s <= 20 ? " warn" : "");
}

/* =====================================================================
   ROBÔ (treino)
   ===================================================================== */
const Bot = (() => {
  let round = null, busy = false, readyT = null;
  const seat = 1;
  function reset(){ round = null; busy = false; clearTimeout(readyT); readyT = null; }
  function think(room){
    const o = Object.assign({}, DEF_OPTS, room.opts), K = knowledge(listOf(room, 0), o.len, o.rep);
    const L = o.len, g = Array(L).fill(null);
    for(let i = 0; i < L; i++) if(K.fixed[i]) g[i] = K.fixed[i];
    const need = []; CHARS.forEach(c => { const k = (K.mn[c] || 0) - K.fixed.filter(x => x === c).length; for(let j = 0; j < k; j++) need.push(c); });
    need.sort(() => Math.random() - .5);
    for(const c of need){ const sl = []; for(let i = 0; i < L; i++) if(!g[i] && !K.ban[i].has(c)) sl.push(i); if(sl.length) g[sl[Math.floor(Math.random() * sl.length)]] = c; }
    const fresh = CHARS.filter(c => !K.mn[c] && !K.dead(c)).sort(() => Math.random() - .5);
    for(let i = 0; i < L; i++){
      if(g[i]) continue;
      if(fresh.length){ g[i] = fresh.pop(); continue; }
      const ok = CHARS.filter(x => !K.dead(x) && !K.ban[i].has(x)); g[i] = ok.length ? ok[Math.floor(Math.random() * ok.length)] : CHARS[0];
    }
    return g.join("");
  }
  function step(room){
    if(!room) return;
    const o = Object.assign({}, DEF_OPTS, room.opts);
    if(room.round !== round){ round = room.round; S.botSecret = randomPw(o.len, o.rep); busy = false; }
    if(room.state === "setup" && !room.players?.[seat]?.ready && !readyT)
      readyT = setTimeout(() => { readyT = null; S.net.update(S.code, { [`players/${seat}/ready`]: true }); }, 1400);
    if(room.state === "play"){
      resolvePending(room, seat, S.botSecret);
      const atk = listOf(room, 0), pending = atk.length && !atk[atk.length - 1].f;
      if(room.turn === seat && !pending && !busy){
        busy = true; const n = atk.length, g = think(room), K = knowledge(atk, o.len, o.rep);
        const typed = K.fixed.map(c => c || ".");
        const order = [...g].map((c, i) => i).filter(i => !K.fixed[i]);
        const still = () => S.solo && S.room?.turn === seat && listOf(S.room, 0).length === n && S.room.state === "play";
        let k = 0;
        const typeNext = () => {
          if(!still()){ busy = false; return; }
          if(k < order.length){ typed[order[k]] = g[order[k]]; k++; S.net.update(S.code, { [`typing/${seat}`]: typed.join("") }); setTimeout(typeNext, S.botFast ? 5 : 130 + Math.random() * 160); }
          else setTimeout(() => { busy = false; if(still()) S.net.update(S.code, { [`guesses/0/${n}`]: { g, f: "" } }); }, S.botFast ? 5 : 600);
        };
        setTimeout(typeNext, S.botFast ? 5 : 1400 + Math.random() * 900);
      }
    }
    if(room.state === "over" && !room.reveal?.[seat] && S.botSecret) S.net.update(S.code, { [`reveal/${seat}`]: S.botSecret.join("") });
  }
  return { step, reset };
})();

/* =====================================================================
   AÇÕES
   ===================================================================== */
const err = m => { const e = $("#err"); if(e) e.textContent = m; Sound.deny(); };
async function create(){
  if(!S.name) return err("Digite seu nome.");
  let code; for(let i = 0; i < 6; i++){ code = newCode(); if(!(await S.net.get(code))) break; }
  await S.net.create(code, { created: Date.now(), state: "lobby", round: 0, opts: { ...DEF_OPTS }, players: { 0: { name: S.name, online: true } } });
  enter(code, 0);
}
async function join(){
  if(!S.name) return err("Digite seu nome.");
  const code = ($("#cd").value || "").toUpperCase().trim();
  if(code.length !== 4) return err("O código tem 4 caracteres.");
  const room = await S.net.get(code);
  if(!room) return err("Sala não encontrada.");
  if(room.players?.[1]) return err("Essa sala já tem dois jogadores.");
  await S.net.update(code, { "players/1": { name: S.name, online: true } });
  Sound.join(); enter(code, 1);
}
async function solo(){
  if(!S.name) S.name = "Você";
  S.realNet = S.net; S.net = memNet(); S.solo = true; Bot.reset();
  await S.net.create("SOLO", { created: Date.now(), state: "lobby", round: 0, opts: { ...DEF_OPTS }, players: { 0: { name: S.name, online: true }, 1: { name: "Robô", online: true, bot: true } } });
  enter("SOLO", 0);
}
function enter(code, seat){
  cleanupRoom();
  S.code = code; S.seat = seat; S.prev = null; S.screen = null; S.shownEnd = null; S.animDone = {}; S.draftKey = null;
  if(!S.solo){ ls.set("qs_session", { code, seat }); try{ history.replaceState(null, "", location.pathname + "?sala=" + code); }catch(e){} }
  S.net.presence(code, seat); renderMenu();
  S.unsub = S.net.subscribe(code, onRoom);
}
function cleanupRoom(){ if(S.unsub) S.unsub(); S.unsub = null; clearInterval(S.timer.id); S.timer.key = null; S.room = null; $(".danger-loop")?.remove(); $(".endov")?.remove(); }
function leave(){
  if(S.code && S.seat != null && !S.solo) S.net.update(S.code, { [`players/${S.seat}/online`]: false });
  if(!S.solo) ls.del("qs_session");
  cleanupRoom(); S.code = null; S.seat = null; S.menu = false; $("#menu").classList.add("hidden");
  if(S.solo){ S.solo = false; S.net = S.realNet; Bot.reset(); }
  try{ history.replaceState(null, "", location.pathname); }catch(e){}
  renderMenu(); viewHome();
}
function start(){
  const o = opts(), first = o.first === "r" ? Math.round(Math.random()) : Number(o.first);
  S.net.update(S.code, { state: "setup", round: (S.room.round || 0) + 1, first, turn: null, lc: null, winner: null, guesses: null, reveal: null, typing: null, "players/0/ready": false, "players/1/ready": false });
}
function lockPw(){
  if(!S.draft.every(Boolean)){ Sound.deny(); return; }
  if(!opts().rep && new Set(S.draft).size !== S.draft.length){ Sound.deny(); return; }
  if(S.solo) S.soloSecret = [...S.draft]; else ls.set(secretKey(), [...S.draft]);
  Sound.lock(); S.net.update(S.code, { [`players/${me()}/ready`]: true });
}
const myTurn = () => { if(S.screen !== "game" || S.room?.state !== "play" || S.room.turn !== me()) return false; const a = listOf(S.room, opp()); return !(a.length && !a[a.length - 1].f); };
const curK = () => knowledge(listOf(S.room, opp()), LEN(), opts().rep);
function typeChar(c){
  const L = LEN();
  if(S.screen === "setup"){
    if(P(me())?.ready) return;
    if(!opts().rep){ const j = S.draft.indexOf(c); if(j >= 0 && j !== S.cur) S.draft[j] = ""; }
    S.draft[S.cur] = c; Sound.key();
    const n = S.draft.findIndex((x, i) => i > S.cur && !x); S.cur = n >= 0 ? n : Math.min(S.cur + 1, L - 1);
    return viewSetup();
  }
  if(!myTurn()) return;
  const K = curK();
  if(K.fixed[S.cur]) return;
  if(K.ban[S.cur].has(c) || K.dead(c)){ Sound.deny(); return; }
  S.draft[S.cur] = c; Sound.key();
  let n = -1; for(let i = S.cur + 1; i < L; i++) if(!K.fixed[i] && !S.draft[i]){ n = i; break; }
  if(n < 0) for(let i = S.cur + 1; i < L; i++) if(!K.fixed[i]){ n = i; break; }
  if(n >= 0) S.cur = n;
  updateGame(); pushTyping();
}
function back(){
  if(S.screen === "setup"){
    if(P(me())?.ready) return;
    if(S.draft[S.cur]) S.draft[S.cur] = ""; else if(S.cur > 0){ S.cur--; S.draft[S.cur] = ""; }
    Sound.del(); return viewSetup();
  }
  if(!myTurn()) return;
  const K = curK();
  if(S.draft[S.cur] && !K.fixed[S.cur]) S.draft[S.cur] = "";
  else { let i = S.cur - 1; while(i >= 0 && K.fixed[i]) i--; if(i >= 0){ S.cur = i; S.draft[i] = ""; } }
  Sound.del(); updateGame(); pushTyping();
}
function moveCur(d){
  if(S.screen === "setup"){ S.cur = Math.max(0, Math.min(LEN() - 1, S.cur + d)); return viewSetup(); }
  if(!myTurn()) return;
  const K = curK(); let i = S.cur + d; while(i >= 0 && i < LEN() && K.fixed[i]) i += d;
  if(i >= 0 && i < LEN()){ S.cur = i; updateGame(); }
}
function send(){
  if(S.screen === "setup") return lockPw();
  if(!myTurn()) return;
  if(!S.draft.every(Boolean)){ const e = $("#entry"); if(e){ e.classList.remove("shake"); void e.offsetWidth; e.classList.add("shake"); } Sound.deny(); return; }
  Sound.send(); clearTimeout(typingT);
  const n = listOf(S.room, opp()).length;
  S.net.update(S.code, { [`guesses/${opp()}/${n}`]: { g: S.draft.join(""), f: "" }, [`typing/${me()}`]: S.draft.join("") });
}

document.addEventListener("click", e => {
  Sound.unlock();
  const t = e.target.closest("button");
  if(!t){ if(S.menu && !e.target.closest("#menu")){ S.menu = false; $("#menu").classList.add("hidden"); } return; }
  if(t.dataset.key) return typeChar(t.dataset.key);
  if(t.dataset.slot != null){
    const i = +t.dataset.slot;
    if(S.screen === "setup"){ S.cur = i; return viewSetup(); }
    if(myTurn() && !curK().fixed[i]){ S.cur = i; updateGame(); } return;
  }
  if(t.dataset.opt){
    if(me() !== 0) return;
    let v = t.dataset.v; v = v === "true" ? true : v === "false" ? false : (t.dataset.opt === "first" ? v : Number(v));
    return S.net.update(S.code, { [`opts/${t.dataset.opt}`]: v });
  }
  const a = t.dataset.act;
  if(a === "create") create();
  else if(a === "join") join();
  else if(a === "solo") solo();
  else if(a === "rejoin"){ const s = ls.get("qs_session"); if(s) S.net.get(s.code).then(r => r ? enter(s.code, s.seat) : (ls.del("qs_session"), viewHome("Essa sala não existe mais."))); }
  else if(a === "copy"){ const url = location.origin + location.pathname + "?sala=" + S.code; navigator.clipboard?.writeText(url).then(() => { t.textContent = "Link copiado!"; }, () => { t.textContent = url; }); }
  else if(a === "start" || a === "rematch") start();
  else if(a === "random"){ S.draft = randomPw(LEN(), opts().rep); S.cur = LEN() - 1; Sound.key(); viewSetup(); }
  else if(a === "lockpw") lockPw();
  else if(a === "send") send();
  else if(a === "sound"){ Sound.toggle(); t.innerHTML = Sound.on ? ICON.sound : ICON.mute; }
  else if(a === "menu"){ S.menu = !S.menu; $("#menu").classList.toggle("hidden", !S.menu); }
  else if(a === "leave") leave();
  else if(a === "eye"){ S.hidePw = !S.hidePw; updateGame(); }
  else if(a === "showend") showEnd();
  else if(a === "closeend") $(".endov")?.remove();
});
document.addEventListener("keydown", e => {
  if(e.target.matches("input") || e.ctrlKey || e.metaKey || e.altKey) return;
  if(S.screen !== "game" && S.screen !== "setup") return;
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if(CHARS.includes(k)){ e.preventDefault(); typeChar(k); }
  else if(k === "Backspace"){ e.preventDefault(); back(); }
  else if(k === "Enter"){ e.preventDefault(); send(); }
  else if(k === "ArrowLeft") moveCur(-1);
  else if(k === "ArrowRight") moveCur(1);
});

/* =====================================================================
   INÍCIO
   ===================================================================== */
(async function boot(){
  shell(); renderMenu();
  try{ S.net = window.FIREBASE_CONFIG ? await firebaseNet(window.FIREBASE_CONFIG) : localNet(); }
  catch(e){ console.error(e); S.net = localNet(); }
  const sess = ls.get("qs_session"), qs = new URLSearchParams(location.search).get("sala");
  if(sess && qs && sess.code === qs.toUpperCase()){ const r = await S.net.get(sess.code).catch(() => null); if(r) return enter(sess.code, sess.seat); }
  viewHome();
})();
window.__QS = S;
})();
