const $=s=>document.querySelector(s);
const colors=["red","green","yellow","blue"];
const colorHex={red:"#f2212d",green:"#08b63d",yellow:"#ffd400",blue:"#14a9e0"};
const PATH=[
[6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],
[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[7,13],[8,13],
[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],
[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[7,1]
];
const START={red:0,green:13,yellow:26,blue:39};
const SAFE=new Set([0,8,13,21,26,34,39,47]);
const HOME_SLOTS={
 red:[[1.4,1.4],[1.4,3.6],[3.6,1.4],[3.6,3.6]],
 green:[[1.4,10.4],[1.4,12.6],[3.6,10.4],[3.6,12.6]],
 blue:[[10.4,1.4],[10.4,3.6],[12.6,1.4],[12.6,3.6]],
 yellow:[[10.4,10.4],[10.4,12.6],[12.6,10.4],[12.6,12.6]]
};

let ws=null,selfId=null,state=null,previousState=null,animating=false,queuedState=null;

function wsUrl(){
 const proto=location.protocol==="https:"?"wss":"ws";
 return `${proto}://${location.host}`;
}
function connect(){
 ws=new WebSocket(wsUrl());
 ws.onopen=()=>{ setMsg(""); };
 ws.onmessage=e=>handle(JSON.parse(e.data));
 ws.onerror=()=>setMsg("Connection problem. Refresh and try again.");
 ws.onclose=()=>{ if(state) setMsg("Disconnected from game server."); };
}
function send(m){if(ws&&ws.readyState===1)ws.send(JSON.stringify(m));}
function setMsg(t){$("#lobbyMsg").textContent=t;$("#gameMsg").textContent=t}
function handle(m){
 if(m.type==="error"){setMsg(m.message);return}
 if(m.type==="joined"){selfId=m.selfId;state=m.state;showGame();render();return}
 if(m.type==="state"){
   const next=m.state;
   const event=m.event||null;
   previousState=state;
   state=next;
   if(event?.type==="move"){animateMove(event).then(()=>render());}
   else if(event?.type==="roll"){animateDice(event.value).then(()=>render());}
   else render();
 }
}
function showGame(){$("#lobby").classList.add("hidden");$("#game").classList.remove("hidden")}
function makeGrid(){
 const board=$("#board"); board.innerHTML="";
 const grid=document.createElement("div");grid.className="grid";
 for(let r=0;r<15;r++)for(let c=0;c<15;c++){
   const el=document.createElement("div");el.className="cell";
   if(r<6&&c<6)el.classList.add("home-red");
   else if(r<6&&c>8)el.classList.add("home-green");
   else if(r>8&&c<6)el.classList.add("home-blue");
   else if(r>8&&c>8)el.classList.add("home-yellow");
   const idx=PATH.findIndex(p=>p[0]===r&&p[1]===c);
   if(idx>=0){el.className="cell path";if(SAFE.has(idx))el.classList.add("safe");}
   if(r>=6&&r<=8&&c>=1&&c<=5)el.classList.add("lane-red");
   if(c>=6&&c<=8&&r>=1&&r<=5)el.classList.add("lane-green");
   if(r>=6&&r<=8&&c>=9&&c<=13)el.classList.add("lane-yellow");
   if(c>=6&&c<=8&&r>=9&&r<=13)el.classList.add("lane-blue");
   if(r>=6&&r<=8&&c>=6&&c<=8)el.className="cell";
   grid.appendChild(el);
 }
 board.appendChild(grid);
 for(const color of colors){
   const h=document.createElement("div");h.className=`home-box home-${color}`;
   for(let i=0;i<4;i++){const slot=document.createElement("div");slot.className="home-slot";h.appendChild(slot)}
   board.appendChild(h);
 }
 const center=document.createElement("div");center.className="center";
 ["green","red","blue","yellow"].forEach(c=>{const t=document.createElement("div");t.className=`tri ${c}`;center.appendChild(t)});
 board.appendChild(center);
 const layer=document.createElement("div");layer.className="pawn-layer";layer.id="pawnLayer";board.appendChild(layer);
}
function cellCenter(r,c){return {left:(c+.5)/15*100,top:(r+.5)/15*100}}
function pawnPos(p,color,i){
 if(p.pos<0){const s=HOME_SLOTS[color][i];return {left:s[1]/15*100,top:s[0]/15*100}}
 if(p.pos>=52){ // final center
   return {left:50+(i%2?3:-3),top:50+(i>1?3:-3)}
 }
 const global=(START[color]+p.pos)%52;
 const [r,c]=PATH[global]; return cellCenter(r,c);
}
function render(){
 if(!state)return;
 $("#roomCode").textContent=state.roomId;
 makeGrid();
 const layer=$("#pawnLayer");
 for(const p of state.players){
   for(let i=0;i<4;i++){
     const pw=p.pawns[i],el=document.createElement("div");
     el.className=`pawn-wrap ${isSelectable(p,i,pw)?"selectable":""}`;
     const pos=pawnPos(pw,p.color,i);el.style.left=pos.left+"%";el.style.top=pos.top+"%";
     el.dataset.player=p.id;el.dataset.pawn=i;
     const ring=document.createElement("div");ring.className="ring";ring.style.color=colorHex[p.color];
     const pawn=document.createElement("div");pawn.className=`pawn ${p.color}`;
     pawn.innerHTML='<span class="head"></span><span class="neck"></span><span class="body"></span><span class="shine"></span>';
     el.append(ring,pawn);
     el.onclick=()=>{if(isSelectable(p,i,pw)&&!animating)send({type:"move",pawn:i})};
     layer.appendChild(el);
   }
 }
 renderPlayers();
 const current=state.players[state.game.turn];
 const myTurn=current?.id===selfId;
 $("#turnBadge").innerHTML=`<span class="dot" style="background:${colorHex[current?.color||"red"]}"></span><span>${current?current.color.toUpperCase()+"'S TURN":"WAITING"}</span>`;
 $("#rollBtn").disabled=!state.game.started||!myTurn||state.game.awaitingMove||animating;
 $("#startPanel").classList.toggle("hidden",!(state.players[0]?.id===selfId&&!state.game.started));
 $("#hint").textContent=state.game.awaitingMove?"Choose a glowing pawn to move.":state.game.started?(myTurn?"Roll the dice.":"Waiting for "+current.name+"…"):"Waiting for the host to start.";
 setDie(state.game.dice||1);
}
function renderPlayers(){
 const box=$("#playerList");box.innerHTML="";
 state.players.forEach(p=>{
  const row=document.createElement("div");row.className="player"+(p.id===selfId?" you":"");
  const av=document.createElement("span");av.className="avatar";av.style.background=colorHex[p.color];
  const name=document.createElement("span");name.className="player-name";name.textContent=p.name;
  const home=document.createElement("span");home.className="player-meta";home.textContent=`${p.pawns.filter(x=>x.pos>=52).length}/4 HOME${p.id===selfId?"  YOU":""}`;
  row.append(av,name,home);box.appendChild(row);
 });
}
function isSelectable(p,i,pw){
 if(p.id!==selfId||!state.game.started||state.game.turn!==state.players.findIndex(x=>x.id===selfId)||!state.game.awaitingMove)return false;
 return legal(pw.pos,state.game.dice,p.color);
}
function legal(pos,dice,color){
 if(pos>=52)return false;
 if(pos<0)return dice===6;
 return pos+dice<=57;
}
function setDie(n){
 const d=$("#die");d.className=`die face-${n}`;
}
function animateDice(value){
 animating=true;$("#rollBtn").disabled=true;
 const d=$("#die");d.classList.add("rolling");
 return new Promise(resolve=>{
  const start=performance.now();
  const timer=setInterval(()=>{setDie(1+Math.floor(Math.random()*6));if(performance.now()-start>760){clearInterval(timer);setDie(value);d.classList.remove("rolling");animating=false;resolve()}},110);
 });
}
function animateMove(ev){
 animating=true;
 const p=state.players.find(x=>x.id===ev.playerId); if(!p){animating=false;return Promise.resolve()}
 const el=[...document.querySelectorAll(".pawn-wrap")].find(x=>x.dataset.player===ev.playerId&&+x.dataset.pawn===ev.pawn);
 if(!el){animating=false;return Promise.resolve()}
 el.classList.add("moving");
 const steps=ev.path||[];
 return new Promise(resolve=>{
   let k=0;
   const step=()=>{
    if(k>=steps.length){animating=false;resolve();return}
    const pos=steps[k++];
    let target;
    if(pos<0){const s=HOME_SLOTS[p.color][ev.pawn];target={left:s[1]/15*100,top:s[0]/15*100}}
    else if(pos>=52){target={left:50+((ev.pawn%2)?3:-3),top:50+((ev.pawn>1)?3:-3)}}
    else {const g=(START[p.color]+pos)%52;target=cellCenter(...PATH[g])}
    el.style.left=target.left+"%";el.style.top=target.top+"%";
    setTimeout(step,175);
   };step();
 });
}
$("#createBtn").onclick=()=>{const name=$("#nameInput").value.trim()||"Player";connect();setTimeout(()=>send({type:"create",name}),200)};
$("#joinBtn").onclick=()=>{const name=$("#nameInput").value.trim()||"Player";const room=$("#roomInput").value.trim().toUpperCase();if(!room)return setMsg("Enter a room code.");connect();setTimeout(()=>send({type:"join",roomId:room,name}),200)};
$("#startBtn").onclick=()=>send({type:"start"});
$("#rollBtn").onclick=()=>{if(!animating)send({type:"roll"})};
$("#copyBtn").onclick=async()=>{try{await navigator.clipboard.writeText(location.href+"\nRoom code: "+state.roomId);$("#gameMsg").textContent="Room link/code copied."}catch{$("#gameMsg").textContent="Room code: "+state.roomId}};
