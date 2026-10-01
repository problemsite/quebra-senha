/* Quebra-Senha — duelo 1v1 online (Firebase Realtime Database) com modo local para testes. */
(() => {
"use strict";
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*?+-_=".split("");
const L = 6;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ls = {
  get(k, d = null){ try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};

/* =====================================================================
   REDE — mesma interface para Firebase e para o modo local
   ===================================================================== */
function applyPatch(obj, patch){
  for(const [path, val] of Object.entries(patch)){
    const parts = path.split("/").filter(Boolean);
    let o = obj;
    for(let i = 0; i < parts.length - 1; i++){
      if(o[parts[i]] == null || typeof o[parts[i]] !== "object") o[parts[i]] = {};
      o = o[parts[i]];
    }
    const last = parts[parts.length - 1];
    if(val === null) delete o[last]; else o[last] = JSON.parse(JSON.stringify(val));
  }
  return obj;
}
function localNet(){
  const ch = ("BroadcastChannel" in window) ? new BroadcastChannel("quebrasenha") : null;
  const subs = {};
  const key = c => "qs_room_" + c;
  const notify = c => { (subs[c] || []).forEach(cb => cb(ls.get(key(c)))); };
  if(ch) ch.onmessage = e => notify(e.data);
  window.addEventListener("storage", e => { if(e.key && e.key.startsWith("qs_room_")) notify(e.key.slice(8)); });
  return {
    mode: "local",
    async get(c){ return ls.get(key(c)); },
    async create(c, data){ ls.set(key(c), data); notify(c); },
    async update(c, patch){ const o = ls.get(key(c)) || {}; ls.set(key(c), applyPatch(o, patch)); notify(c); if(ch) ch.postMessage(c); },
    subscribe(c, cb){ (subs[c] = subs[c] || []).push(cb); cb(ls.get(key(c))); return () => { subs[c] = (subs[c] || []).filter(x => x !== cb); }; },
    presence(){}
  };
}
function loadScript(src){
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
async function firebaseNet(cfg){
  const V = "10.12.2";
  await loadScript(`https://www.gstatic.com/firebasejs/${V}/firebase-app-compat.js`);
  await loadScript(`https://www.gstatic.com/firebasejs/${V}/firebase-database-compat.js`);
  firebase.initializeApp(cfg);
  const db = firebase.database();
  const ref = c => db.ref("quebrasenha/rooms/" + c);
  return {
    mode: "online",
    async get(c){ const s = await ref(c).get(); return s.val(); },
    async create(c, data){ await ref(c).set(data); },
    async update(c, patch){ await ref(c).update(patch); },
    subscribe(c, cb){ const h = s => cb(s.val()); ref(c).on("value", h); return () => ref(c).off("value", h); },
    presence(c, seat){
      const r = ref(c).child(`players/${seat}/online`);
      db.ref(".info/connected").on("value", s => { if(s.val()){ r.onDisconnect().set(false); r.set(true); } });
    }
  };
}

function memNet(){
  let data = {}; const subs = {};
  const fire = c => setTimeout(() => (subs[c] || []).forEach(cb => cb(data[c] ? JSON.parse(JSON.stringify(data[c])) : null)), 0);
  return {
    mode: "solo",
    async get(c){ return data[c] ? JSON.parse(JSON.stringify(data[c])) : null; },
    async create(c, d){ data[c] = JSON.parse(JSON.stringify(d)); fire(c); },
    async update(c, patch){ data[c] = applyPatch(data[c] || {}, patch); fire(c); },
    subscribe(c, cb){ (subs[c] = subs[c] || []).push(cb); fire(c); return () => { subs[c] = []; }; },
    presence(){}
  };
}

/* ---------- robô do modo treino ---------- */
const Bot = (() => {
  let secret = null, round = null, busy = false, readyT = null;
  const seat = 1;
  function reset(){ secret = null; round = null; busy = false; clearTimeout(readyT); }
  function think(room){
    const list = listOf(room, 0), K = knowledge(list), rep = !!room.opts?.rep;
    const tested = new Set(); revealed(list).forEach(e => [...e.g].forEach(c => tested.add(c)));
    const g = Array(L).fill(null);
    for(let i = 0; i < L; i++) if(K.fixed[i]) g[i] = K.fixed[i];
    // caracteres que existem mas ainda não estão no lugar
    const need = [];
    CHARS.forEach(c => { const k = K.ch[c].min - K.fixed.filter(x => x === c).length; for(let j = 0; j < k; j++) need.push(c); });
    need.sort(() => Math.random() - .5);
    for(const c of need){
      const slots = []; for(let i = 0; i < L; i++) if(!g[i] && !K.ban[i].has(c)) slots.push(i);
      if(slots.length) g[slots[Math.floor(Math.random() * slots.length)]] = c;
    }
    const fresh = CHARS.filter(c => !tested.has(c) && K.state[c] !== "R").sort(() => Math.random() - .5);
    for(let i = 0; i < L; i++){
      if(g[i]) continue;
      let c = fresh.find(x => rep || !g.includes(x));
      if(c){ fresh.splice(fresh.indexOf(c), 1); g[i] = c; continue; }
      const opt = CHARS.filter(x => K.state[x] !== "R" && !K.ban[i].has(x) && (rep || !g.includes(x)));
      g[i] = opt.length ? opt[Math.floor(Math.random() * opt.length)] : CHARS.find(x => !g.includes(x));
    }
    return g.join("");
  }
  function step(room){
    if(!room) return;
    if(room.round !== round){ round = room.round; secret = randomPw(!!room.opts?.rep); busy = false; }
    if(room.state === "setup" && !room.players?.[seat]?.ready && !readyT){
      readyT = setTimeout(() => { readyT = null; S.net.update(S.code, { [`players/${seat}/ready`]: true }); }, 1400);
    }
    if(room.state === "play"){
      resolvePending(room, seat, secret);
      const atk = listOf(room, 0), pending = atk.length && !atk[atk.length - 1].f;
      if(room.turn === seat && !pending && !busy){
        busy = true;
        const n = atk.length;
        setTimeout(() => {
          busy = false;
          if(!S.solo || S.room?.turn !== seat || listOf(S.room, 0).length !== n || S.room.state !== "play") return;
          S.net.update(S.code, { [`guesses/0/${n}`]: { g: think(S.room), f: "" } });
        }, 2200 + Math.random() * 2200);
      }
    }
    if(room.state === "over" && !room.reveal?.[seat]) S.net.update(S.code, { [`reveal/${seat}`]: secret.join("") });
  }
  return { step, reset };
})();

/* =====================================================================
   SOM — tudo sintetizado, sem arquivos
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
    key(){ tone(1400, .04, "triangle", .05); },
    del(){ tone(500, .05, "triangle", .05, 0, 300); },
    deny(){ tone(220, .09, "square", .05); tone(180, .12, "square", .05, .08); },
    send(){ tone(500, .18, "sawtooth", .04, 0, 1400); noise(.18, .04, 0, 3000); },
    reveal(f, i){ const d = i * .13;
      if(f === "G"){ tone(1047, .25, "sine", .14, d); tone(1568, .25, "sine", .06, d + .02); }
      else if(f === "O"){ tone(660, .18, "triangle", .12, d); }
      else { tone(160, .14, "sine", .14, d, 90); noise(.06, .03, d, 300); } },
    newGreen(){ [784, 988, 1175, 1568].forEach((f, i) => tone(f, .22, "sine", .11, .85 + i * .07)); },
    allFound(){ [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, .3, "triangle", .1, .85 + i * .09)); },
    near(){ for(let i = 0; i < 3; i++){ tone(880, .12, "square", .06, .9 + i * .22); tone(660, .12, "square", .05, 1.0 + i * .22); } },
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
   LÓGICA DO JOGO
   ===================================================================== */
function feedback(secret, guess){
  const res = Array(L).fill("R"), cnt = {};
  for(let i = 0; i < L; i++){ if(guess[i] === secret[i]) res[i] = "G"; else cnt[secret[i]] = (cnt[secret[i]] || 0) + 1; }
  for(let i = 0; i < L; i++){ if(res[i] !== "G" && cnt[guess[i]] > 0){ res[i] = "O"; cnt[guess[i]]--; } }
  return res.join("");
}
const listOf = (room, pc) => { const o = room?.guesses?.[pc]; if(!o) return []; return Object.keys(o).map(Number).sort((a,b)=>a-b).map(k => o[k]); };
const revealed = list => list.filter(e => e.f && !e.s);
function knowledge(list){
  const ch = {}; CHARS.forEach(c => ch[c] = { min: 0, exact: null });
  const fixed = Array(L).fill(null), ban = Array.from({ length: L }, () => new Set());
  for(const a of revealed(list)){
    const g = [...a.g], f = a.f, seen = {}, hasR = {};
    g.forEach((c, i) => { if(f[i] === "G") fixed[i] = c; else ban[i].add(c); if(f[i] !== "R") seen[c] = (seen[c] || 0) + 1; else hasR[c] = true; });
    for(const c of new Set(g)){ const k = seen[c] || 0; ch[c].min = Math.max(ch[c].min, k); if(hasR[c]) ch[c].exact = k; }
  }
  const state = {};
  CHARS.forEach(c => {
    const k = ch[c];
    if(k.exact === 0) state[c] = "R";
    else if(k.min > 0) state[c] = fixed.filter(x => x === c).length >= k.min ? "G" : "O";
    else state[c] = "";
  });
  const found = Math.min(L, CHARS.reduce((s, c) => s + ch[c].min, 0));
  const greens = fixed.filter(Boolean).length;
  return { ch, state, fixed, ban, found, greens };
}
function randomPw(rep){
  if(rep) return Array.from({ length: L }, () => CHARS[Math.floor(Math.random() * CHARS.length)]);
  const a = [...CHARS]; for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, L);
}
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");

/* =====================================================================
   ESTADO LOCAL
   ===================================================================== */
const S = {
  net: null, code: null, seat: null, name: ls.get("qs_name", ""), room: null, prev: null, unsub: null,
  screen: null, draft: Array(L).fill(""), cur: 0, sentKey: null, hidePw: false,
  cam: ls.get("qs_cam", "frame"), menu: false,
  timer: { key: null, left: 0, id: null }, shownEnd: null
};
const me = () => S.seat, opp = () => 1 - S.seat;
const P = i => S.room?.players?.[i] || null;
const nameOf = i => P(i)?.name || (i === 0 ? "Player 1" : "Player 2");
const secretKey = () => `qs_secret_${S.code}_${S.room?.round || 0}_${S.seat}`;
const mySecret = () => ls.get(secretKey());
const opts = () => S.room?.opts || { rep: false, time: 0, last: true, first: "0" };

/* =====================================================================
   ÍCONES / PEÇAS
   ===================================================================== */
const hexSVG = (fill, stroke = "rgba(255,255,255,.9)", sw = 4) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="hg${fill.replace(/[^a-z0-9]/gi,"")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
  <path d="M50 4 L90 27 L90 73 L50 96 L10 73 L10 27 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
  <path d="M50 4 L90 27 L90 73 L50 96 L10 73 L10 27 Z" fill="url(#hg${fill.replace(/[^a-z0-9]/gi,"")})"/></svg>`;
const pColor = i => i === 0 ? "#22c7e6" : "#ff9a3d";
const ICON = {
  sound: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>`,
  mute: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>`
};
const toolsHTML = () => `<div class="tools">
  <button class="icon-btn" data-act="sound" aria-label="Som" title="Som">${Sound.on ? ICON.sound : ICON.mute}</button>
  <button class="icon-btn" data-act="menu" aria-label="Configurações" title="Configurações">${ICON.gear}</button></div>`;
function menuHTML(){
  return `<div class="menu panel ${S.menu ? "" : "hidden"}" id="menu">
    <div class="field"><label>Opções</label></div>
    ${S.code ? `<button class="btn soft" data-act="leave">${S.solo ? "Sair do treino" : "Sair da sala"}</button>` : `<div class="mode-note" style="text-align:left">Entre numa sala para ver mais opções.</div>`}
  </div>`;
}

/* =====================================================================
   TELAS
   ===================================================================== */
const app = $("#app");
function go(screen){ S.screen = screen; }

function viewHome(err = ""){
  go("home");
  const sess = ls.get("qs_session");
  const qsCode = new URLSearchParams(location.search).get("sala") || "";
  app.innerHTML = `<div class="center">
    <div style="position:fixed;top:18px;right:22px">${toolsHTML()}</div>${menuHTML()}
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px">
      <div class="hexav" style="width:96px;height:96px">${hexSVG("#ffffff","#0a1c28",5)}</div>
      <div class="eyebrow">Duelo 1v1</div>
      <h1 class="logo">Quebra-<span>Senha</span></h1>
      <p class="tag">Proteja seu PC com uma senha de 6 caracteres e invada o do outro primeiro.</p>
    </div>
    <div class="panel home-card">
      <div class="field"><label for="nm">Seu nome</label><input id="nm" class="input" maxlength="16" placeholder="Ex.: Problems" value="${esc(S.name)}"></div>
      <button class="btn cyan" data-act="create">Criar sala</button>
      <div class="or">OU</div>
      <div class="row2"><input id="cd" class="input code" maxlength="4" placeholder="CÓDIGO" value="${esc(qsCode)}" aria-label="Código da sala"><button class="btn orange" data-act="join">Entrar</button></div>
      <div class="or">OU</div>
      <button class="btn soft" data-act="solo">Treinar sozinho contra o robô</button>
      ${sess ? `<button class="btn soft" data-act="rejoin">Voltar para a sala ${esc(sess.code)}</button>` : ""}
      <div class="err" id="err">${esc(err)}</div>
    </div>
    <div class="mode-note">${S.net?.mode === "local"
      ? `<b>Modo local:</b> sem Firebase configurado, a sala só funciona entre duas abas deste navegador. Para jogar em dois computadores, preencha o <code>firebase-config.js</code>.`
      : `Online · Sem login. Crie uma sala e mande o código para o outro jogador.`}</div>
  </div>`;
  const nm = $("#nm");
  nm.oninput = () => { S.name = nm.value.trim(); ls.set("qs_name", S.name); };
  const cd = $("#cd"); cd.oninput = () => cd.value = cd.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  cd.onkeydown = e => { if(e.key === "Enter") join(); };
}

function playerCard(i){
  const p = P(i), mine = i === me();
  let st = "Vaga aberta", chip = `<span class="chip">aguardando jogador</span>`;
  if(p){
    st = p.online === false ? "Desconectado" : "Conectado";
    if(S.room.state === "setup") chip = p.ready ? `<span class="chip ok">senha trancada</span>` : `<span class="chip">criando senha…</span>`;
    else chip = `<span class="chip ok">pronto</span>`;
  }
  return `<div class="panel pcard p${i+1} ${mine ? "me" : ""}">
    <div class="hexav ${p ? "" : "empty"}">${hexSVG(pColor(i))}<b>${p ? esc(p.name[0]?.toUpperCase() || "?") : "+"}</b></div>
    <h3>${esc(p ? p.name : "Player " + (i+1))}</h3><div class="st">${st}</div>${chip}</div>`;
}
function viewLobby(){
  go("lobby");
  const o = opts(), host = me() === 0, full = !!P(1);
  const seg = (k, vals) => `<div class="seg">${vals.map(([v,t]) => `<button data-opt="${k}" data-v="${v}" class="${String(o[k])===String(v)?"on":""}" ${host?"":"disabled"}>${t}</button>`).join("")}</div>`;
  app.innerHTML = `<div class="center">
    <div style="position:fixed;top:18px;right:22px">${toolsHTML()}</div>${menuHTML()}
    <div style="text-align:center"><div class="eyebrow">Lobby</div><h1 class="logo" style="font-size:clamp(40px,4.6vw,64px)">Quebra-<span>Senha</span></h1></div>
    <div class="lobby">${playerCard(0)}<div class="vs">VS</div>${playerCard(1)}</div>
    <div class="lobby-foot">
      ${S.solo ? `<div class="panel codebox"><div class="eyebrow">Modo treino</div><div class="code" style="font-size:30px;letter-spacing:4px">SOLO</div><div class="mode-note">O robô cria a senha dele e joga sozinho.</div></div>`
      : `<div class="panel codebox"><div class="eyebrow">Código da sala</div><div class="code">${esc(S.code)}</div>
        <button class="btn soft" data-act="copy" style="padding:9px 16px;font-size:13px">Copiar link</button></div>`}
      <div class="panel" style="display:flex;flex-direction:column;gap:14px">
        <div class="opts">
          <div class="field"><label>Repetir caracteres</label>${seg("rep", [[false,"Não"],[true,"Sim"]])}</div>
          <div class="field"><label>Tempo por jogada</label>${seg("time", [[0,"Livre"],[60,"60s"],[90,"90s"],[120,"120s"]])}</div>
          <div class="field"><label>Quem começa</label>${seg("first", [["0", esc(nameOf(0)).slice(0,10)],["1", esc(nameOf(1)).slice(0,10)],["r","Sorteio"]])}</div>
          <div class="field"><label>Última chance</label>${seg("last", [[true,"Sim"],[false,"Não"]])}</div>
        </div>
      </div>
    </div>
    <div class="lobby-cta">
      ${host ? `<button class="btn cyan" data-act="start" ${full ? "" : "disabled"} style="min-width:260px">${full ? "Começar partida" : "Esperando o Player 2"}</button>`
             : `<div class="waiting">Esperando ${esc(nameOf(0))} começar <span class="dots"><i></i><i></i><i></i></span></div>`}
      <div class="mode-note">Última chance: se quem começa acertar, o outro ainda tem uma jogada para empatar.</div>
    </div>
  </div>`;
}

const LOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
const UNLOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>`;
function monitor(title, inner, id = "", extra = ""){
  return `<div class="pc ${extra}" ${id ? `id="${id}"` : ""}>
    <div class="bezel"><div class="screen">
      <div class="winbar"><span class="lk" data-lk>${LOCK}</span><span class="wt">${title}</span><span class="wstat" data-st>BLOQUEADO</span><span class="wright" data-wr></span></div>
      <div class="sbody">${inner}</div>
    </div><div class="chin"><i></i></div></div>
    <div class="neck"></div><div class="foot"></div>
  </div>`;
}
function viewSetup(){
  go("setup");
  const sec = mySecret();
  const locked = !!P(me())?.ready && sec;
  const rep = opts().rep;
  if(!locked && !S.draft.some(Boolean)) S.cur = 0;
  app.innerHTML = `<div class="center">
    <div style="position:fixed;top:18px;right:22px">${toolsHTML()}</div>${menuHTML()}
    ${monitor(`Meu PC · <b>${esc(nameOf(me()))}</b>`, `<div class="setup">
      <div class="eyebrow" style="text-align:center">Rodada ${S.room.round}</div>
      <h2>${locked ? "PC trancado" : "Crie a senha do seu PC"}</h2>
      <p>${locked ? `Esperando ${esc(nameOf(opp()))} trancar o dele.` : `6 caracteres entre letras, números e símbolos${rep ? ". Pode repetir." : ", sem repetir."} A senha fica só neste computador.`}</p>
      ${locked
        ? `<div class="lockpw">${sec.map(c => `<div class="tile G">${esc(c)}</div>`).join("")}</div>`
        : `<div class="entry" id="entry">${S.draft.map((c,i)=>`<button class="slot ${i===S.cur?"cur":""}" data-slot="${i}" aria-label="Posição ${i+1}">${esc(c)}</button>`).join("")}</div>
           <div class="kb" id="kb">${CHARS.map(c => `<button class="key ${!rep && S.draft.includes(c) ? "used" : ""}" data-key="${esc(c)}">${esc(c)}</button>`).join("")}</div>
           <div class="actions"><button class="btn soft" data-act="random">Sortear</button><button class="btn cyan" data-act="lockpw" ${S.draft.every(Boolean) ? "" : "disabled"}>Trancar senha</button></div>`}
      <div class="statusrow">${[0,1].map(i => `<span class="chip ${P(i)?.ready ? "ok" : ""}">${esc(nameOf(i))}: ${P(i)?.ready ? "trancado" : "criando…"}</span>`).join("")}</div>
    </div>`, "", "setup-pc " + (locked ? "" : "open"))}
  </div>`;
  if(!locked){ const st = $("[data-st]"); st.textContent = "CONFIGURANDO"; st.classList.add("cfg"); $("[data-lk]").innerHTML = UNLOCK; }
}

/* ---------- partida ---------- */
function viewGame(){
  go("game");
  app.innerHTML = `<div class="game">
    <div class="col side left" id="left"></div>
    <div class="col"><div class="board">
      <div class="topbar"><div class="mini-logo">Quebra-<span>Senha</span></div><div class="turnpill" id="turn"></div>${toolsHTML()}</div>
      ${monitor(`PC de <b>${esc(nameOf(opp()))}</b>`, `<div class="play"><div class="hist" id="hist"></div>
      <div id="entryWrap"></div>
      <div class="kb" id="kb"></div></div>`, "pc")}
    </div></div>
    <div class="col side right" id="right"></div>
  </div>${menuHTML()}`;
  S.histCount = -1;
  updateGame();
}
function camHTML(){ return `<div class="cam" aria-hidden="true"></div>`; }
function updateGame(fresh){
  const room = S.room, mine = room.turn === me() && room.state === "play";
  const atk = listOf(room, opp()), K = knowledge(atk);
  const def = listOf(room, me()), KD = knowledge(def);
  const last = room.lc != null;

  // barra de turno
  const tp = $("#turn");
  tp.className = "turnpill" + (mine ? " mine" : "") + (last ? " last" : "");
  tp.innerHTML = `<span>${last ? "Última chance · " : ""}${mine ? "Sua vez" : "Vez de " + esc(nameOf(room.turn))}</span>${opts().time ? `<span class="t" id="tm"></span>` : ""}`;
  renderTimer();
  const nT = atk.filter(e=>!e.s).length;
  $("[data-wr]").textContent = `${nT} tentativa${nT===1?"":"s"}`;
  const won = room.state === "over" && (room.winner === "draw" || Number(room.winner) === me());
  const pcEl = $("#pc"); pcEl.classList.toggle("live", mine); pcEl.classList.toggle("unlocked", won);
  const stEl = $("[data-st]"); stEl.textContent = won ? "DESBLOQUEADO" : "BLOQUEADO"; stEl.classList.toggle("ok", won);
  $("[data-lk]").innerHTML = won ? UNLOCK : LOCK;

  // histórico
  const hist = $("#hist");
  const key = atk.map(e => (e.f || "?") + (e.s ? "s" : "")).join("|");
  if(hist.dataset.key !== key){
    const prevRevealed = Number(hist.dataset.rev || 0);
    const nowRevealed = atk.filter(e => e.f).length;
    hist.innerHTML = atk.length ? atk.map((e, r) => {
      if(e.s) return `<div class="grow skip"><div class="tile" style="grid-column:span 6">tempo esgotado</div></div>`;
      const g = [...e.g];
      if(!e.f) return `<div class="grow">${g.map(c => `<div class="tile scan">${esc(c)}</div>`).join("")}</div>`;
      const anim = fresh !== false && r >= prevRevealed && r < nowRevealed && hist.dataset.key != null;
      return `<div class="grow">${g.map((c, i) => `<div class="tile ${e.f[i]} ${anim ? "flip" : ""}" style="${anim ? `animation-delay:${i*130}ms` : ""}">${esc(c)}</div>`).join("")}</div>`;
    }).join("") : `<div class="empty"><b>Nenhuma tentativa ainda</b>Verde: lugar certo · Laranja: existe em outro lugar · Vermelho: não existe</div>`;
    hist.dataset.key = key; hist.dataset.rev = nowRevealed;
    requestAnimationFrame(() => hist.scrollTop = hist.scrollHeight);
  }

  // entrada
  const ew = $("#entryWrap");
  const pending = atk.length && !atk[atk.length - 1].f;
  if(mine && !pending){
    const turnKey = room.round + ":" + atk.length;
    if(S.draftKey !== turnKey){ S.draftKey = turnKey; S.draft = Array(L).fill(""); prefill(K); }
    const warn = entryWarning(K);
    ew.innerHTML = `<div class="entry" id="entry">${S.draft.map((c, i) => {
      let cls = "slot"; if(K.fixed[i]) cls += " lock"; else if(i === S.cur) cls += " cur";
      if(c && !K.fixed[i] && K.ban[i].has(c)) cls += " bad";
      return `<button class="${cls}" data-slot="${i}" aria-label="Posição ${i+1}">${esc(c)}</button>`;
    }).join("")}</div>
    <div class="hintline ${warn ? "warn" : ""}" style="margin-top:8px">${warn || "Digite no teclado e aperte Enter"}</div>
    <div class="actions" style="margin-top:6px"><button class="btn cyan" data-act="send" ${S.draft.every(Boolean) && !warn.startsWith("!") ? "" : "disabled"}>Testar senha</button></div>`;
  } else if(room.state === "play"){
    ew.innerHTML = `<div class="waiting">${pending ? "Verificando" : `${esc(nameOf(opp()))} está tentando a sua senha`} <span class="dots"><i></i><i></i><i></i></span></div>`;
  } else ew.innerHTML = `<div class="actions"><button class="btn cyan" data-act="showend">Ver resultado</button></div>`;

  // teclado
  const used = !opts().rep ? new Set(S.draft.filter((c, i) => c && !K.fixed[i])) : new Set();
  $("#kb").innerHTML = CHARS.map(c => {
    let cls = "key " + K.state[c];
    if(mine && K.state[c] !== "R" && !K.fixed[S.cur] && K.ban[S.cur].has(c) && K.state[c] !== "") cls += " nothere";
    if(used.has(c)) cls += " used";
    return `<button class="${cls}" data-key="${esc(c)}" ${!mine || K.state[c] === "R" ? "disabled" : ""}>${esc(c)}</button>`;
  }).join("");

  // lateral esquerda: você
  $("#left").innerHTML = `<div class="panel side-card">
      <div class="who"><div class="hx">${hexSVG(pColor(me()),"rgba(255,255,255,.9)",6)}<b>${esc(nameOf(me())[0]?.toUpperCase())}</b></div>
        <div style="min-width:0"><div class="nm">${esc(nameOf(me()))}</div><div class="sub">Você · invadindo</div></div></div>
      <div class="lbl"><span>No lugar certo</span><span class="big-n">${K.greens}<small>/6</small></span></div>
      <div class="meter">${Array.from({length:L},(_,i)=>`<i class="${i < K.greens ? "on" : i < K.found ? "half" : ""}"></i>`).join("")}</div>
    </div>${camHTML()}`;

  // lateral direita: adversário
  const sec = mySecret() || [];
  $("#right").innerHTML = `<div class="panel side-card ${KD.greens >= 4 ? "danger" : ""}" id="oppcard">
      <div class="who"><div class="hx">${hexSVG(pColor(opp()),"rgba(255,255,255,.9)",6)}<b>${esc(nameOf(opp())[0]?.toUpperCase())}</b></div>
        <div style="min-width:0"><div class="nm">${esc(nameOf(opp()))}</div><div class="sub">${P(opp())?.online === false ? "desconectado" : "atacando seu PC"}</div></div></div>
      <div class="lbl"><span>Na sua senha</span><span class="big-n">${KD.greens}<small>/6</small></span></div>
      <div class="meter">${Array.from({length:L},(_,i)=>`<i class="${i < KD.greens ? "on" : i < KD.found ? "half" : ""}"></i>`).join("")}</div>
      <div class="lbl"><span>Sua senha</span><button class="eye" data-act="eye">${S.hidePw ? "MOSTRAR" : "ESCONDER"}</button></div>
      <div class="mypw ${S.hidePw ? "blur" : ""}">${sec.map((c, i) => `<div class="tile ${KD.fixed[i] ? "G" : ""}">${esc(c)}</div>`).join("")}</div>
      <div class="opp-hist" id="opph">${def.length ? def.map(e => e.s ? `<div class="grow skip"><div class="tile" style="grid-column:span 6">tempo esgotado</div></div>`
          : `<div class="grow">${[...e.g].map((c, i) => `<div class="tile ${e.f ? e.f[i] : "scan"}">${esc(c)}</div>`).join("")}</div>`).join("")
        : `<div class="empty">Nenhuma tentativa dele ainda.</div>`}</div>
    </div>${camHTML()}`;
  const oh = $("#opph"); if(oh) oh.scrollTop = oh.scrollHeight;

  // brilho de perigo constante quando o outro está perto
  let dl = $(".danger-loop");
  if(KD.greens >= 5 && room.state === "play"){ if(!dl){ dl = document.createElement("div"); dl.className = "danger-loop"; document.body.appendChild(dl); } }
  else if(dl) dl.remove();
}
function entryWarning(K){
  if(!opts().rep){
    const d = S.draft.filter(Boolean).find((c, i, a) => a.indexOf(c) !== i);
    if(d) return `! Sem repetição: "${d}" aparece duas vezes.`;
  }
  const bad = S.draft.map((c, i) => c && !K.fixed[i] && K.ban[i].has(c) && K.state[c] !== "R" ? c : null).filter(Boolean);
  if(bad.length) return `${bad.join(", ")} já foi testado nessa posição e não é ali.`;
  return "";
}
function prefill(K){
  for(let i = 0; i < L; i++) if(K.fixed[i]) S.draft[i] = K.fixed[i];
  S.cur = nextFree(-1, K);
}
function nextFree(from, K){
  for(let i = from + 1; i < L; i++) if(!K || !K.fixed[i]) if(!S.draft[i] || i > from) { if(!K || !K.fixed[i]) return i; }
  return Math.max(0, Math.min(L - 1, from));
}

/* ---------- fim ---------- */
const plural = n => `${n} tentativa${n === 1 ? "" : "s"}`;
function showEnd(){
  const room = S.room, w = room.winner;
  const res = w === "draw" ? "draw" : (Number(w) === me() ? "win" : "lose");
  const title = { win: "Acesso liberado!", lose: "Seu PC foi invadido", draw: "Empate!" }[res];
  const sub = res === "draw" ? "Os dois quebraram a senha na mesma rodada."
    : res === "win" ? `Você quebrou a senha de ${esc(nameOf(opp()))} em ${plural(listOf(room, opp()).filter(e=>!e.s).length)}.`
    : `${esc(nameOf(opp()))} quebrou sua senha em ${plural(listOf(room, me()).filter(e=>!e.s).length)}.`;
  const pw = i => room.reveal?.[i] ? [...room.reveal[i]] : null;
  let ov = $(".endov"); if(!ov){ ov = document.createElement("div"); ov.className = "endov"; document.body.appendChild(ov); }
  ov.innerHTML = `<div class="panel endcard ${res}">
    <div class="eyebrow">${res === "win" ? "Vitória" : res === "lose" ? "Derrota" : "Rodada " + room.round}</div>
    <h1>${title}</h1><p>${sub}</p>
    <div class="reveal-grid">${[0,1].map(i => `<div><div class="lbl">Senha de ${esc(nameOf(i))}</div>
      <div class="grow">${(pw(i) || Array(L).fill("•")).map((c, k) => `<div class="tile ${pw(i) ? "G flip" : ""}" style="animation-delay:${k*120}ms">${esc(c)}</div>`).join("")}</div></div>`).join("")}</div>
    <div class="actions">${me() === 0 ? `<button class="btn cyan" data-act="rematch">Revanche</button>` : `<div class="waiting">Esperando ${esc(nameOf(0))} pedir revanche</div>`}
      <button class="btn soft" data-act="closeend">Ver tabuleiro</button><button class="btn soft" data-act="leave">Sair</button></div>
  </div>`;
}

/* =====================================================================
   EFEITOS
   ===================================================================== */
function burst(text, color = "cyan", small = "", delay = 0){
  setTimeout(() => {
    const fx = $("#fx"); fx.innerHTML = "";
    const d = document.createElement("div"); d.className = "burst " + color; d.innerHTML = text + (small ? `<small>${small}</small>` : "");
    fx.appendChild(d); setTimeout(() => d.remove(), 1700);
  }, delay);
}
function vignette(color, delay = 0){ setTimeout(() => { const v = document.createElement("div"); v.className = "vignette " + color; document.body.appendChild(v); setTimeout(() => v.remove(), 1500); }, delay); }
function sweep(){ const v = document.createElement("div"); v.className = "sweep"; document.body.appendChild(v); setTimeout(() => v.remove(), 1000); }
function confetti(){
  const cv = $("#confetti"), cx = cv.getContext("2d"); cv.width = innerWidth; cv.height = innerHeight;
  const cols = ["#2fd8f2", "#22d38a", "#ffffff", "#ff9a3d", "#8ff0ff"];
  const ps = Array.from({ length: 160 }, () => ({ x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .45, vx: (Math.random() - .5) * 16, vy: -Math.random() * 16 - 4, r: 6 + Math.random() * 9, a: Math.random() * 6, va: (Math.random() - .5) * .3, c: cols[Math.floor(Math.random() * cols.length)] }));
  let t = 0;
  (function f(){
    cx.clearRect(0, 0, cv.width, cv.height); t++;
    ps.forEach(p => { p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.a); cx.fillStyle = p.c; cx.globalAlpha = Math.max(0, 1 - t / 220);
      cx.beginPath(); for(let k = 0; k < 6; k++){ const an = Math.PI / 3 * k; cx.lineTo(Math.cos(an) * p.r, Math.sin(an) * p.r); } cx.fill(); cx.restore(); });
    if(t < 220) requestAnimationFrame(f); else cx.clearRect(0, 0, cv.width, cv.height);
  })();
}
function flashKeys(chars){ chars.forEach(c => { const k = $(`.key[data-key="${CSS.escape(c)}"]`); if(k){ k.classList.remove("flash"); void k.offsetWidth; k.classList.add("flash"); } }); }

/* =====================================================================
   DETECÇÃO DE MOMENTOS IMPORTANTES
   ===================================================================== */
function events(prev, room){
  if(!prev || prev.round !== room.round || room.state !== "play" && room.state !== "over") return;
  // minhas tentativas reveladas
  const pa = listOf(prev, opp()), na = listOf(room, opp());
  const pr = revealed(pa).length, nr = revealed(na).length;
  if(nr > pr){
    const e = revealed(na)[nr - 1]; [...e.f].forEach((f, i) => Sound.reveal(f, i));
    const K0 = knowledge(pa), K1 = knowledge(na);
    setTimeout(() => flashKeys([...e.g]), 800);
    if(e.f === "GGGGGG"){ /* tratado no fim/última chance */ }
    else if(K1.greens === 5 && K0.greens < 5){ Sound.near(); burst("Falta 1!", "orange", "só mais um no lugar", 850); vignette("orange", 850); }
    else if(K1.found === 6 && K0.found < 6){ Sound.allFound(); burst("Todos encontrados!", "cyan", "agora é só acertar a ordem", 850); vignette("green", 850); }
    else if(K1.greens > K0.greens){ Sound.newGreen(); const n = K1.greens - K0.greens; burst(n > 1 ? `+${n} verdes!` : "Novo verde!", "green", "", 850); }
    else if(!/[GO]/.test(e.f)){ burst("Tudo vermelho", "red", "6 caracteres eliminados", 850); }
  }
  // tentativas do adversário na minha senha
  const pd = listOf(prev, me()), nd = listOf(room, me());
  if(revealed(nd).length > revealed(pd).length){
    const K0 = knowledge(pd), K1 = knowledge(nd);
    if(K1.greens > K0.greens && K1.greens < 6){
      setTimeout(() => {
        if(K1.greens >= 5){ Sound.alarm(); burst("Alerta!", "red", `${esc(nameOf(opp()))} está a 1 caractere`); vignette("red"); }
        else Sound.oppGreen();
        const c = $("#oppcard"); if(c){ c.classList.remove("alarm"); void c.offsetWidth; c.classList.add("alarm"); }
      }, 300);
    }
  }
  // última chance começou
  if(prev.lc == null && room.lc != null && room.state === "play"){
    setTimeout(() => {
      Sound.lastChance(); vignette("orange");
      if(room.turn === me()) burst("Última chance!", "orange", `${esc(nameOf(opp()))} acertou. Acerte agora para empatar.`);
      else { burst("Senha quebrada!", "green", `${esc(nameOf(opp()))} ainda tem uma chance de empatar`); confetti(); }
    }, 900);
    return;
  }
  // mudou o turno para mim
  if(room.state === "play" && prev.turn !== room.turn && room.turn === me()){
    setTimeout(() => { Sound.turn(); sweep(); burst("Sua vez", "cyan"); }, prev.state === "play" ? 1500 : 200);
  }
}

/* =====================================================================
   SINCRONIZAÇÃO
   ===================================================================== */
function onRoom(room){
  if(!room){ if(S.code){ ls.del("qs_session"); cleanupRoom(); viewHome("A sala não existe mais."); } return; }
  const prev = S.prev; S.room = room; S.prev = JSON.parse(JSON.stringify(room));
  if(prev && prev.players && !prev.players[1] && room.players?.[1]) Sound.join();

  // eu sou o defensor: respondo as tentativas contra o meu PC
  if(room.state === "play") resolvePending(room);
  // host: inicia a partida quando os dois trancaram
  if(room.state === "setup" && me() === 0 && P(0)?.ready && P(1)?.ready) S.net.update(S.code, { state: "play", turn: Number(room.first) });
  // revela minha senha no fim
  if(room.state === "over" && !room.reveal?.[me()] && mySecret()) S.net.update(S.code, { [`reveal/${me()}`]: mySecret().join("") });

  const want = { lobby: "lobby", setup: "setup", play: "game", over: "game" }[room.state];
  if(want === "setup" && (S.screen !== "setup" || prev?.round !== room.round)){ if(prev?.round !== room.round || S.screen !== "setup") S.draft = Array(L).fill(""); }
  if(want !== S.screen || (prev && prev.round !== room.round)){
    const e = $(".endov"); if(e) e.remove();
    ({ lobby: viewLobby, setup: viewSetup, game: viewGame })[want]();
    if(want === "game" && prev?.state === "setup"){ setTimeout(() => { sweep(); Sound.turn(); burst(room.turn === me() ? "Você começa" : `${esc(nameOf(room.turn))} começa`, "cyan", "Que comece a invasão"); }, 300); }
  } else if(want === "game") updateGame();
  else if(want === "lobby") viewLobby();
  else if(want === "setup") viewSetup();

  events(prev, room);
  syncTimer();
  if(S.solo) Bot.step(room);

  if(room.state === "over" && S.shownEnd !== room.round + ":" + JSON.stringify(room.reveal || {})){
    const first = S.shownEnd == null || !S.shownEnd.startsWith(room.round + ":");
    S.shownEnd = room.round + ":" + JSON.stringify(room.reveal || {});
    const w = room.winner, res = w === "draw" ? "draw" : (Number(w) === me() ? "win" : "lose");
    if(first){
      setTimeout(() => {
        if(res === "win"){ Sound.win(); confetti(); vignette("green"); } else if(res === "lose"){ Sound.lose(); vignette("red"); } else { Sound.allFound(); confetti(); }
        showEnd();
      }, 1300);
    } else if($(".endov")) showEnd();
  }
}
function resolvePending(room, def = me(), sec = mySecret()){
  const list = listOf(room, def); if(!list.length) return;
  const n = list.length - 1, e = list[n];
  if(e.f) return;
  if(!sec) return;
  const attacker = 1 - def, first = Number(room.first), second = 1 - first;
  const patch = {};
  let solved = false;
  if(e.s) patch[`guesses/${def}/${n}/f`] = "------";
  else { const fb = feedback(sec, [...e.g]); patch[`guesses/${def}/${n}/f`] = fb; solved = fb === "GGGGGG"; }
  const lc = room.lc;
  if(solved){
    if(attacker === first && opts().last && lc == null){ patch.lc = attacker; patch.turn = second; }
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
      if(S.timer.left <= 0){
        clearInterval(S.timer.id); Sound.timeout(); burst("Tempo esgotado", "red");
        const n = listOf(S.room, opp()).length;
        S.net.update(S.code, { [`guesses/${opp()}/${n}`]: { g: "", f: "", s: true } });
      }
    }
    if(S.timer.left <= 0) clearInterval(S.timer.id);
  }, 1000);
}
function renderTimer(){
  const el = $("#tm"); if(!el) return;
  const s = Math.max(0, S.timer.left);
  el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  el.className = "t" + (s <= 10 ? " crit" : s <= 20 ? " warn" : "");
}

/* =====================================================================
   AÇÕES
   ===================================================================== */
async function create(){
  if(!S.name) return err("Digite seu nome.");
  let code; for(let i = 0; i < 6; i++){ code = newCode(); if(!(await S.net.get(code))) break; }
  await S.net.create(code, { created: Date.now(), state: "lobby", round: 0, opts: { rep: false, time: 0, last: true, first: "0" }, players: { 0: { name: S.name, online: true } } });
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
function enter(code, seat){
  cleanupRoom();
  S.code = code; S.seat = seat; S.prev = null; S.screen = null; S.shownEnd = null;
  if(!S.solo){
    ls.set("qs_session", { code, seat });
    try{ history.replaceState(null, "", location.pathname + "?sala=" + code); }catch(e){}
  }
  S.net.presence(code, seat);
  S.unsub = S.net.subscribe(code, onRoom);
}
function cleanupRoom(){ if(S.unsub) S.unsub(); S.unsub = null; clearInterval(S.timer.id); S.timer.key = null; S.room = null; const d = $(".danger-loop"); if(d) d.remove(); const e = $(".endov"); if(e) e.remove(); }
function leave(){
  if(S.code && S.seat != null) S.net.update(S.code, { [`players/${S.seat}/online`]: false });
  if(!S.solo) ls.del("qs_session");
  cleanupRoom(); S.code = null; S.seat = null; S.menu = false;
  if(S.solo){ S.solo = false; S.net = S.realNet; Bot.reset(); }
  try{ history.replaceState(null, "", location.pathname); }catch(e){}
  viewHome();
}
async function solo(){
  if(!S.name) S.name = "Você";
  S.realNet = S.net; S.net = memNet(); S.solo = true; Bot.reset();
  const code = "SOLO";
  await S.net.create(code, { created: Date.now(), state: "lobby", round: 0, opts: { rep: false, time: 0, last: true, first: "0" },
    players: { 0: { name: S.name, online: true }, 1: { name: "Robô", online: true, bot: true } } });
  enter(code, 0);
}
function err(m){ const e = $("#err"); if(e) e.textContent = m; Sound.deny(); }
function start(){
  const o = opts(); const first = o.first === "r" ? String(Math.round(Math.random())) : o.first;
  S.net.update(S.code, { state: "setup", round: (S.room.round || 0) + 1, first: Number(first), turn: null, lc: null, winner: null, guesses: null, reveal: null, "players/0/ready": false, "players/1/ready": false });
}

function typeChar(c){
  if(S.screen === "setup"){
    if(P(me())?.ready) return;
    if(!opts().rep){ const j = S.draft.indexOf(c); if(j >= 0 && j !== S.cur) S.draft[j] = ""; }
    S.draft[S.cur] = c; Sound.key();
    const n = S.draft.findIndex((x, i) => i > S.cur && !x); S.cur = n >= 0 ? n : Math.min(S.cur + 1, L - 1);
    viewSetup(); popSlot(); return;
  }
  if(S.screen !== "game" || S.room.turn !== me() || S.room.state !== "play") return;
  const K = knowledge(listOf(S.room, opp()));
  if(K.state[c] === "R"){ Sound.deny(); return; }
  if(K.fixed[S.cur]) return;
  if(!opts().rep){ const j = S.draft.findIndex((x, i) => x === c && !K.fixed[i]); if(j >= 0 && j !== S.cur) S.draft[j] = ""; }
  S.draft[S.cur] = c; Sound.key();
  let n = -1; for(let i = S.cur + 1; i < L; i++) if(!K.fixed[i] && !S.draft[i]){ n = i; break; }
  if(n < 0) for(let i = S.cur + 1; i < L; i++) if(!K.fixed[i]){ n = i; break; }
  S.cur = n >= 0 ? n : S.cur;
  updateGame(false); popSlot();
}
function popSlot(){ const s = $(`.slot[data-slot="${S.cur}"]`); }
function back(){
  if(S.screen === "setup"){
    if(P(me())?.ready) return;
    if(S.draft[S.cur]) S.draft[S.cur] = ""; else if(S.cur > 0){ S.cur--; S.draft[S.cur] = ""; }
    Sound.del(); viewSetup(); return;
  }
  if(S.screen !== "game" || S.room.turn !== me()) return;
  const K = knowledge(listOf(S.room, opp()));
  if(S.draft[S.cur] && !K.fixed[S.cur]) S.draft[S.cur] = "";
  else { let i = S.cur - 1; while(i >= 0 && K.fixed[i]) i--; if(i >= 0){ S.cur = i; S.draft[i] = ""; } }
  Sound.del(); updateGame(false);
}
function moveCur(d){
  if(S.screen === "setup"){ S.cur = Math.max(0, Math.min(L - 1, S.cur + d)); viewSetup(); return; }
  if(S.screen !== "game") return;
  const K = knowledge(listOf(S.room, opp()));
  let i = S.cur + d; while(i >= 0 && i < L && K.fixed[i]) i += d;
  if(i >= 0 && i < L){ S.cur = i; updateGame(false); }
}
function send(){
  if(S.screen === "setup") return lockPw();
  if(S.screen !== "game" || S.room.turn !== me() || S.room.state !== "play") return;
  const atk = listOf(S.room, opp());
  if(atk.length && !atk[atk.length - 1].f) return;
  const K = knowledge(atk);
  if(!S.draft.every(Boolean) || entryWarning(K).startsWith("!")){ const e = $("#entry"); if(e){ e.classList.remove("shake"); void e.offsetWidth; e.classList.add("shake"); } Sound.deny(); return; }
  Sound.send();
  S.net.update(S.code, { [`guesses/${opp()}/${atk.length}`]: { g: S.draft.join(""), f: "" } });
}
function lockPw(){
  if(!S.draft.every(Boolean)){ Sound.deny(); return; }
  if(!opts().rep && new Set(S.draft).size !== L){ Sound.deny(); return; }
  ls.set(secretKey(), [...S.draft]); Sound.lock();
  S.net.update(S.code, { [`players/${me()}/ready`]: true });
}

/* ---------- eventos de interface ---------- */
document.addEventListener("click", e => {
  Sound.unlock();
  const t = e.target.closest("button"); if(!t) { if(S.menu && !e.target.closest("#menu")){ S.menu = false; $("#menu")?.classList.add("hidden"); } return; }
  if(t.dataset.key) return typeChar(t.dataset.key);
  if(t.dataset.slot != null){
    if(S.screen === "setup"){ S.cur = +t.dataset.slot; viewSetup(); return; }
    const K = knowledge(listOf(S.room, opp())); const i = +t.dataset.slot; if(!K.fixed[i]){ S.cur = i; updateGame(false); } return;
  }
  if(t.dataset.opt){
    if(me() !== 0) return;
    let v = t.dataset.v; v = v === "true" ? true : v === "false" ? false : (/^\d+$/.test(v) && t.dataset.opt === "time") ? Number(v) : v;
    S.net.update(S.code, { [`opts/${t.dataset.opt}`]: v }); return;
  }
  const a = t.dataset.act;
  if(a === "create") create();
  else if(a === "join") join();
  else if(a === "solo") solo();
  else if(a === "rejoin"){ const s = ls.get("qs_session"); if(s) S.net.get(s.code).then(r => r ? enter(s.code, s.seat) : (ls.del("qs_session"), viewHome("Essa sala não existe mais."))); }
  else if(a === "copy"){ const url = location.origin + location.pathname + "?sala=" + S.code; navigator.clipboard?.writeText(url).then(() => { t.textContent = "Link copiado!"; }, () => { t.textContent = url; }); }
  else if(a === "start") start();
  else if(a === "random"){ S.draft = randomPw(opts().rep); S.cur = L - 1; Sound.key(); viewSetup(); }
  else if(a === "lockpw") lockPw();
  else if(a === "send") send();
  else if(a === "sound"){ Sound.toggle(); t.innerHTML = Sound.on ? ICON.sound : ICON.mute; }
  else if(a === "menu"){ S.menu = !S.menu; $("#menu")?.classList.toggle("hidden", !S.menu); }
  else if(a === "leave") leave();
  else if(a === "eye"){ S.hidePw = !S.hidePw; updateGame(false); }
  else if(a === "rematch") start();
  else if(a === "showend") showEnd();
  else if(a === "closeend"){ const o = $(".endov"); if(o) o.remove(); }
});
document.addEventListener("keydown", e => {
  if(e.target.matches("input")) return;
  if(e.ctrlKey || e.metaKey || e.altKey) return;
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
function bgRain(){
  const cv = document.createElement("canvas"); cv.id = "bg"; document.body.prepend(cv);
  const cx = cv.getContext("2d"), still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W, H, cols, drops, fs = 15, gap = 34;
  function size(){ W = cv.width = innerWidth; H = cv.height = innerHeight; cols = Math.ceil(W / gap);
    drops = Array.from({ length: cols }, () => ({ y: Math.random() * H, v: .25 + Math.random() * .6, on: Math.random() < .45, len: 6 + Math.floor(Math.random() * 14) })); }
  size(); addEventListener("resize", size);
  const glyph = () => CHARS[Math.floor(Math.random() * CHARS.length)];
  const cache = drops.map(() => []);
  function frame(){
    cx.clearRect(0, 0, W, H); cx.font = `700 ${fs}px "JetBrains Mono", monospace`; cx.textAlign = "center";
    drops.forEach((d, i) => {
      if(!d.on) return;
      const x = i * gap + gap / 2;
      cache[i] = cache[i] || [];
      for(let k = 0; k < d.len; k++){
        const y = d.y - k * (fs + 6); if(y < -20 || y > H + 20) continue;
        if(!cache[i][k] || Math.random() < .02) cache[i][k] = glyph();
        const a = k === 0 ? .32 : .16 * (1 - k / d.len);
        cx.fillStyle = k === 0 ? `rgba(160,245,255,${a})` : `rgba(47,216,242,${a})`;
        cx.fillText(cache[i][k], x, y);
      }
      if(!still){ d.y += d.v; if(d.y - d.len * (fs + 6) > H){ d.y = -20; d.on = Math.random() < .5; d.v = .25 + Math.random() * .6; } }
      else if(!d.done){ d.done = 1; }
    });
    if(!still) requestAnimationFrame(frame);
  }
  frame();
  // colunas apagadas voltam aos poucos
  if(!still) setInterval(() => { const d = drops[Math.floor(Math.random() * drops.length)]; if(d && !d.on){ d.on = true; d.y = -20; } }, 900);
}
(async function boot(){
  bgRain();
  try{ S.net = window.FIREBASE_CONFIG ? await firebaseNet(window.FIREBASE_CONFIG) : localNet(); }
  catch(e){ console.error(e); S.net = localNet(); }
  const sess = ls.get("qs_session"), qs = new URLSearchParams(location.search).get("sala");
  if(sess && qs && sess.code === qs.toUpperCase()){
    const r = await S.net.get(sess.code);
    if(r) return enter(sess.code, sess.seat);
  }
  viewHome();
})();
window.__QS = S; // ajuda para depuração
})();
