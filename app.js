const $ = (id) => document.getElementById(id);
const boardEl = $("board");
const playersEl = $("players");
const statusEl = $("status");
const rollBtn = $("roll");
const startBtn = $("start");
const dieBtn = $("dice");
const modal = $("modal");
const modalError = $("modalError");
const roomCodeEl = $("roomCode");
const turnBadge = $("turnBadge");

const COLORS = ["red", "green", "yellow", "blue"];
const COLOR_HEX = { red: "#ef2028", green: "#08b83a", yellow: "#ffe000", blue: "#12a9e8" };
const DIE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

// 15x15 standard-style Ludo board. 52 shared-track squares, then a 5-square
// colour-specific home lane and the centre finish.
const TRACK = [
  [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],
  [1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],
  [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
  [14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[7,1]
];

const UNIQUE_TRACK = TRACK;

const START = { red: 0, green: 13, yellow: 26, blue: 39 };
const HOME_LANE = {
  red: [[7,2],[7,3],[7,4],[7,5],[7,6]],
  green: [[6,7],[5,7],[4,7],[3,7],[2,7]],
  yellow: [[7,12],[7,11],[7,10],[7,9],[7,8]],
  blue: [[8,7],[9,7],[10,7],[11,7],[12,7]]
};
const YARD = {
  red: [[2.05,2.05],[3.95,2.05],[2.05,3.95],[3.95,3.95]],
  green: [[11.05,2.05],[12.95,2.05],[11.05,3.95],[12.95,3.95]],
  yellow: [[11.05,11.05],[12.95,11.05],[11.05,12.95],[12.95,12.95]],
  blue: [[2.05,11.05],[3.95,11.05],[2.05,12.95],[3.95,12.95]]
};
const SAFE = new Set([0,8,13,21,26,34,39,47]);

let state = null;
let selfId = null;
let rolled = null;
let diceTimer = null;

const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

function send(message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
function svg(tag, attrs = {}) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k,v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function drawBoard() {
  boardEl.innerHTML = "";
  const s = svg("svg", { viewBox: "0 0 900 900", role: "img", "aria-label": "Interactive Ludo board" });
  const unit = 60;
  s.appendChild(svg("rect", { x:0, y:0, width:900, height:900, fill:"#fff" }));

  const quadrants = {
    red: [0,0], green:[9,0], yellow:[9,9], blue:[0,9]
  };
  const inner = { red:[1,1], green:[10,1], yellow:[10,10], blue:[1,10] };

  for (const color of COLORS) {
    const [x,y] = quadrants[color];
    const [ix,iy] = inner[color];
    s.appendChild(svg("rect", { x:x*unit, y:y*unit, width:360, height:360, fill:COLOR_HEX[color] }));
    s.appendChild(svg("rect", { x:ix*unit, y:iy*unit, width:240, height:240, rx:4, fill:"#fff", stroke:"#222", "stroke-width":3 }));
    for (const [gx,gy] of YARD[color]) {
      s.appendChild(svg("circle", { cx:gx*unit, cy:gy*unit, r:31, fill:COLOR_HEX[color], stroke:"#222", "stroke-width":2 }));
      s.appendChild(svg("circle", { cx:gx*unit, cy:gy*unit-4, r:7, fill:"#fff", opacity:.3 }));
    }
  }

  const inCross = (r,c) => (r >= 6 && r <= 8) || (c >= 6 && c <= 8);
  for (let r=0;r<15;r++) for (let c=0;c<15;c++) {
    if (!inCross(r,c)) continue;
    s.appendChild(svg("rect", { x:c*unit, y:r*unit, width:unit, height:unit, fill:"#fff", stroke:"#777", "stroke-width":1.5 }));
  }

  // Coloured home lanes, centred in the three-square-wide arms.
  for (const color of COLORS) {
    for (const [r,c] of HOME_LANE[color]) {
      s.appendChild(svg("rect", { x:c*unit, y:r*unit, width:unit, height:unit, fill:COLOR_HEX[color], stroke:"#777", "stroke-width":1.5 }));
    }
  }

  // Colour the four starting squares.
  for (const color of COLORS) {
    const [r,c] = UNIQUE_TRACK[START[color]];
    s.appendChild(svg("rect", { x:c*unit, y:r*unit, width:unit, height:unit, fill:COLOR_HEX[color], stroke:"#555", "stroke-width":2 }));
  }

  // Subtle safe-square markers.
  for (const idx of SAFE) {
    const [r,c] = UNIQUE_TRACK[idx];
    const g = svg("g", { transform:`translate(${c*unit+30} ${r*unit+30})`, opacity:.6 });
    g.appendChild(svg("circle", { cx:0, cy:0, r:10, fill:"none", stroke:"#222", "stroke-width":2 }));
    g.appendChild(svg("path", { d:"M0 -6 L1.8 -1.8 L6 0 L1.8 1.8 L0 6 L-1.8 1.8 L-6 0 L-1.8 -1.8 Z", fill:"#222" }));
    s.appendChild(g);
  }

  // Centre finish triangle.
  const cx=450, cy=450;
  const tri = {
    red:`${cx},${cy} ${360},${360} ${360},${540}`,
    green:`${cx},${cy} ${360},${360} ${540},${360}`,
    yellow:`${cx},${cy} ${540},${360} ${540},${540}`,
    blue:`${cx},${cy} ${360},${540} ${540},${540}`
  };
  for (const color of COLORS) s.appendChild(svg("polygon", { points:tri[color], fill:COLOR_HEX[color], stroke:"#444", "stroke-width":2 }));

  const tokens = svg("g", { id:"tokens" });
  s.appendChild(tokens);
  boardEl.appendChild(s);
}

drawBoard();

function trackIndex(color, progress) { return (START[color] + progress) % 52; }
function positionFor(color, progress, index) {
  if (progress < 0) return YARD[color][index];
  if (progress >= 56) return [7.5,7.5];
  if (progress >= 51) {
    const [r,c] = HOME_LANE[color][progress-51];
    return [c+.5, r+.5];
  }
  const [r,c] = UNIQUE_TRACK[trackIndex(color, progress)];
  return [c+.5, r+.5];
}
function canMove(tokenProgress, dice) {
  if (tokenProgress >= 56) return false;
  if (tokenProgress < 0) return dice === 6;
  return tokenProgress + dice <= 56;
}

function renderTokens() {
  const g = boardEl.querySelector("#tokens");
  if (!g || !state) return;
  g.innerHTML = "";
  const current = state.players[state.game?.turn ?? 0];
  for (const p of state.players) {
    p.tokens.forEach((progress, index) => {
      const [x,y] = positionFor(p.color, progress, index);
      const selectable = rolled && current?.id === selfId && rolled.legal.includes(index) && p.id === selfId;
      const wrapper = svg("g", { transform:`translate(${x*60} ${y*60})`, class:`pawn ${selectable ? "selectable" : ""}` });
      if (selectable) {
        wrapper.style.cursor = "pointer";
        wrapper.addEventListener("click", () => choosePawn(index));
      }
      wrapper.appendChild(svg("circle", { cx:0, cy:0, r:24, fill:COLOR_HEX[p.color], stroke:"#fff", "stroke-width":4, "paint-order":"stroke" }));
      wrapper.appendChild(svg("circle", { cx:-7, cy:-9, r:7, fill:"#fff", opacity:.35 }));
      wrapper.appendChild(svg("text", { x:0, y:6, "text-anchor":"middle", "font-size":15, "font-weight":900, fill:p.color === "yellow" ? "#222" : "#fff" })).textContent = String(index+1);
      g.appendChild(wrapper);
    });
  }
}

function render() {
  if (!state) return;
  const current = state.players[state.game?.turn ?? 0];
  roomCodeEl.textContent = `ROOM ${state.roomId}`;
  turnBadge.textContent = state.game?.winner ? "GAME OVER" : current ? `${current.color.toUpperCase()}'S TURN` : "WAITING";
  playersEl.innerHTML = state.players.map(p => `
    <div class="player ${current?.id === p.id ? "active" : ""}">
      <span class="dot ${p.color}"></span><span class="player-name">${esc(p.name)}</span>
      ${p.id === selfId ? '<span class="you">YOU</span>' : ''}
      <span class="score">${p.tokens.filter(t => t >= 56).length}/4</span>
    </div>`).join("");

  startBtn.hidden = state.started;
  startBtn.disabled = state.players.length < 2;
  rollBtn.disabled = !state.started || !!state.game?.winner || !current || current.id !== selfId || !!rolled;

  if (state.game?.winner) statusEl.textContent = `${state.players.find(p=>p.id===state.game.winner)?.name || "Player"} wins! 🎉`;
  else if (!state.started) statusEl.textContent = state.players.length < 2 ? "Waiting for another player…" : "Everyone's here — start the game!";
  else if (current?.id === selfId) statusEl.textContent = rolled ? "Pick a glowing pawn to move." : "Your turn — roll the dice!";
  else statusEl.textContent = `Waiting for ${current?.name || "the other player"}…`;

  renderTokens();
}

function showDie(n) {
  dieBtn.querySelector("span").textContent = DIE[n] || "—";
}
function animateDice(final) {
  clearInterval(diceTimer);
  dieBtn.classList.add("rolling");
  let ticks = 0;
  diceTimer = setInterval(() => {
    showDie(1 + Math.floor(Math.random()*6));
    ticks++;
    if (ticks >= 12) {
      clearInterval(diceTimer);
      dieBtn.classList.remove("rolling");
      showDie(final);
    }
  }, 65);
}
function choosePawn(index) {
  if (!rolled || !rolled.legal.includes(index)) return;
  send({ type:"move", token:index });
  rolled = null;
  render();
}

rollBtn.addEventListener("click", () => send({ type:"roll" }));
dieBtn.addEventListener("click", () => { if (!rollBtn.disabled) send({ type:"roll" }); });
startBtn.addEventListener("click", () => send({ type:"start" }));
$("create").addEventListener("click", () => {
  const name = $("name").value.trim() || "Player";
  send({ type:"create", name });
});
$("join").addEventListener("click", () => {
  const name = $("name").value.trim() || "Player";
  const roomId = $("joinCode").value.trim().toUpperCase();
  if (roomId.length !== 5) { modalError.textContent = "Enter the 5-letter room code."; return; }
  send({ type:"join", roomId, name });
});

socket.addEventListener("open", () => { statusEl.textContent = "Connected — create or join a room."; });
socket.addEventListener("message", event => {
  const m = JSON.parse(event.data);
  if (m.type === "error") { modalError.textContent = m.message; return; }
  if (m.type === "joined") {
    selfId = m.selfId;
    state = m.state;
    modal.classList.add("hidden");
    render();
    return;
  }
  if (m.type === "rollResult") {
    rolled = { legal:m.legal };
    animateDice(m.dice);
    render();
    return;
  }
  if (m.type === "state") {
    state = m.state;
    if (!state.game?.dice) rolled = null;
    render();
  }
});
socket.addEventListener("close", () => { statusEl.textContent = "Connection lost — refresh the page to reconnect."; });
