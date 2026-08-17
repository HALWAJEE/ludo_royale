const $ = (s) => document.querySelector(s);
const board = $("#board");
const lobby = $("#lobby");
const game = $("#game");
const rollBtn = $("#rollBtn");
const die = $("#die");
const hint = $("#hint");
const errorBox = $("#error");
const roomCodeEl = $("#roomCode");
const turnBadge = $("#turnBadge");
const playersEl = $("#players");
const playersLobby = $("#playersLobby");
const startBtn = $("#startBtn");

const COLORS = ["red","green","yellow","blue"];
const SYMBOLS = ["⚀","⚁","⚂","⚃","⚄","⚅"];
const PATH = [
  [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],
  [1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],
  [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
  [14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],
  [8,0],[7,0],[6,0]
];
const LANES = {
  red:[[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
  green:[[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
  yellow:[[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
  blue:[[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]]
};
const BASES = {
  red:[[2,2],[2,4],[4,2],[4,4]],
  green:[[2,10],[2,12],[4,10],[4,12]],
  blue:[[10,2],[10,4],[12,2],[12,4]],
  yellow:[[10,10],[10,12],[12,10],[12,12]]
};
const START = {red:0,green:13,yellow:26,blue:39};
const SAFE = new Set([0,8,13,21,26,34,39,47]);

let ws = null;
let selfId = null;
let state = null;
let rollingTimer = null;

function wsUrl(){
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}
function connect(){
  ws = new WebSocket(wsUrl());
  ws.onopen = () => { turnBadge.textContent = "READY"; };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if(m.type==="joined"){ selfId=m.selfId; state=m.state; showState(); }
    if(m.type==="state"){ state=m.state; showState(); }
    if(m.type==="error"){ errorBox.textContent=m.message; }
  };
  ws.onclose = () => { turnBadge.textContent="OFFLINE"; setTimeout(connect,1500); };
}
connect();

function send(obj){ if(ws && ws.readyState===1) ws.send(JSON.stringify(obj)); }
function player(){ return state?.players?.find(p=>p.id===selfId); }
function currentPlayer(){ return state?.players?.[state.game?.turn % state.players.length]; }

function showState(){
  if(!state) return;
  roomCodeEl.textContent = state.roomId;
  renderLobbyPlayers();
  if(state.started){
    lobby.classList.add("hidden");
    game.classList.remove("hidden");
    renderBoard();
    renderPlayers();
    renderDice();
  }else{
    lobby.classList.remove("hidden");
    game.classList.add("hidden");
    startBtn.classList.toggle("hidden", !(state.players.length>=2 && state.players[0]?.id===selfId));
  }
}

function renderLobbyPlayers(){
  playersLobby.innerHTML = "";
  (state?.players||[]).forEach(p=>{
    const d=document.createElement("div");
    d.className="lobby-player";
    d.textContent=`${p.name} • ${p.color.toUpperCase()}`;
    playersLobby.appendChild(d);
  });
}

function cell(r,c,cls=""){
  const el=document.createElement("div");
  el.className=`cell ${cls}`;
  el.style.gridRow=r+1;
  el.style.gridColumn=c+1;
  return el;
}

function buildBoard(){
  board.innerHTML="";
  // home quadrants
  for(const color of ["red","green","blue","yellow"]){
    const home=document.createElement("div");
    home.className=`home ${color}`;
    const pad=document.createElement("div");
    pad.className="home-pad";
    BASES[color].forEach((_,i)=>{
      const s=document.createElement("div");
      s.className=`base-spot s${i+1}`;
      pad.appendChild(s);
    });
    home.appendChild(pad);
    board.appendChild(home);
  }

  const pathSet=new Set(PATH.map(([r,c])=>`${r},${c}`));
  for(let r=0;r<15;r++) for(let c=0;c<15;c++){
    if((r<6&&c<6)||(r<6&&c>8)||(r>8&&c<6)||(r>8&&c>8)) continue;
    if(r>=6&&r<=8&&c>=6&&c<=8) continue;
    if(!pathSet.has(`${r},${c}`) && !Object.values(LANES).some(l=>l.some(([rr,cc])=>rr===r&&cc===c))) continue;
    let cls="track";
    const idx=PATH.findIndex(([rr,cc])=>rr===r&&cc===c);
    if(idx>=0){
      if(idx===START.red) cls+=" red-start";
      if(idx===START.green) cls+=" green-start";
      if(idx===START.yellow) cls+=" yellow-start";
      if(idx===START.blue) cls+=" blue-start";
      if(SAFE.has(idx)) cls+=" safe";
    }
    for(const [color,lane] of Object.entries(LANES)){
      if(lane.some(([rr,cc])=>rr===r&&cc===c)) cls=`track lane-${color}`;
    }
    board.appendChild(cell(r,c,cls));
  }

  const center=document.createElement("div");
  center.className="center";
  ["green","red","yellow","blue"].forEach(c=>{
    const t=document.createElement("div"); t.className=`tri ${c}`; center.appendChild(t);
  });
  board.appendChild(center);
}

function posFor(color, pawnIndex, pos){
  if(pos<0) return BASES[color][pawnIndex];
  if(pos<=51){
    const start=START[color];
    const idx=(start+pos)%52;
    return PATH[idx];
  }
  const lane=LANES[color];
  return lane[Math.min(pos-52,lane.length-1)];
}

function boardPercent(r,c){
  return {left:`${(c+.5)/15*100}%`, top:`${(r+.5)/15*100}%`};
}

function renderBoard(){
  buildBoard();
  const players=state.players||[];
  players.forEach(p=>{
    const pawns=state.game?.pawns?.[p.color] || [-1,-1,-1,-1];
    pawns.forEach((pos,i)=>{
      const [r,c]=posFor(p.color,i,pos);
      const el=document.createElement("button");
      el.type="button";
      el.className=`pawn ${p.color}`;
      el.dataset.color=p.color;
      el.dataset.index=i;
      const pc=boardPercent(r,c);
      el.style.left=pc.left; el.style.top=pc.top;
      const ring=document.createElement("span"); ring.className="ring";
      const piece=document.createElement("span"); piece.className="piece";
      const head=document.createElement("span"); head.className="head";
      const body=document.createElement("span"); body.className="body";
      const shine=document.createElement("span"); shine.className="shine";
      const foot=document.createElement("span"); foot.className="foot";
      piece.append(head,body,shine,foot);
      el.append(ring,piece);
      const can = isSelectable(p,i,pos);
      if(can) el.classList.add("selectable");
      el.addEventListener("click",()=>{ if(can) send({type:"move",pawn:i}); });
      board.appendChild(el);
    });
  });
}

function isSelectable(p,i,pos){
  if(!state?.game || state.game.turnColor!==p.color || state.game.dice==null || state.game.awaitingMove!==true) return false;
  if(p.id!==selfId) return false;
  return legalMove(pos,state.game.dice,p.color);
}
function legalMove(pos,dice,color){
  if(pos===57) return false;
  if(pos===-1) return dice===6;
  return pos+dice<=57;
}

function renderPlayers(){
  playersEl.innerHTML="";
  (state.players||[]).forEach(p=>{
    const row=document.createElement("div");
    row.className="player-row"+(p.id===selfId?" you":"");
    const dot=document.createElement("span"); dot.className="dot"; dot.style.background=`var(--${p.color})`;
    const name=document.createElement("span"); name.className="player-name"; name.textContent=p.name;
    const count=document.createElement("span"); count.className="piece-count";
    const pawns=state.game?.pawns?.[p.color]||[-1,-1,-1,-1];
    count.textContent=`${pawns.filter(x=>x===57).length}/4 HOME`;
    const status=document.createElement("span"); status.className="player-status";
    status.textContent=p.id===selfId?"YOU":"";
    row.append(dot,name,count,status);
    playersEl.appendChild(row);
  });
}

function renderDice(){
  const g=state.game;
  if(!g){die.textContent="–";return}
  die.textContent=g.dice?SYMBOLS[g.dice-1]:"–";
  const me=player();
  const mine=me && g.turnColor===me.color;
  rollBtn.disabled=!(state.started && mine && !g.awaitingMove);
  if(g.winner){
    turnBadge.textContent=`${g.winner.toUpperCase()} WINS!`;
    hint.textContent="Game over — all four pawns reached home.";
  }else{
    turnBadge.textContent=`${g.turnColor.toUpperCase()}'S TURN`;
    if(g.awaitingMove) hint.textContent="Choose a glowing pawn.";
    else if(mine) hint.textContent="Roll the dice.";
    else hint.textContent=`Waiting for ${g.turnColor.toUpperCase()}…`;
  }
}

function animateDice(finalValue){
  die.classList.add("rolling");
  let ticks=0;
  clearInterval(rollingTimer);
  rollingTimer=setInterval(()=>{
    die.textContent=SYMBOLS[Math.floor(Math.random()*6)];
    ticks++;
    if(ticks>=10){
      clearInterval(rollingTimer);
      die.classList.remove("rolling");
      die.textContent=SYMBOLS[finalValue-1];
    }
  },90);
}

$("#createBtn").onclick=()=>{
  errorBox.textContent="";
  send({type:"create",name:$("#nameInput").value.trim()||"Player"});
};
$("#joinBtn").onclick=()=>{
  errorBox.textContent="";
  send({type:"join",roomId:$("#roomInput").value.trim(),name:$("#nameInput").value.trim()||"Player"});
};
startBtn.onclick=()=>send({type:"start"});
rollBtn.onclick=()=>send({type:"roll"});
$("#copyBtn").onclick=async()=>{
  try{await navigator.clipboard.writeText(state.roomId); $("#copyBtn").textContent="ROOM CODE COPIED ✓"; setTimeout(()=>$("#copyBtn").textContent="COPY ROOM CODE",1400)}
  catch{alert(`Room code: ${state.roomId}`)}
};
