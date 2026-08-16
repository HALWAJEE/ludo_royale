let ws,me,state;
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const starts={red:0,green:13,yellow:26,blue:39};
const pathCells=[
[6,0],[6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0]];
const lanes={red:[[7,1],[7,2],[7,3],[7,4],[7,5]],green:[[1,7],[2,7],[3,7],[4,7],[5,7]],yellow:[[7,13],[7,12],[7,11],[7,10],[7,9]],blue:[[13,7],[12,7],[11,7],[10,7],[9,7]]};
function connect(){ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host);ws.onmessage=e=>{let m=JSON.parse(e.data);if(m.type==="error"){alert(m.message);return}if(m.type==="joined"){me=m.selfId;state=m.state;showWait()}if(m.type==="state"){state=m.state;if(state.started)showGame();else renderWait()}}}
function send(type,data={}){if(ws&&ws.readyState===1)ws.send(JSON.stringify({type,...data}))}
connect();
$("create").onclick=()=>send("create",{name:$("name").value.trim()||"Player"});
$("join").onclick=()=>send("join",{name:$("name").value.trim()||"Player",roomId:$("room").value.trim().toUpperCase()});
$("start").onclick=()=>send("start");
$("roll").onclick=()=>send("roll");
function showWait(){$("lobby").classList.add("hidden");$("waiting").classList.remove("hidden");renderWait()}
function renderWait(){$("code").textContent=state.roomId;$("players").innerHTML=state.players.map(p=>`<div class="player"><span class="dot ${p.color}"></span><b>${esc(p.name)}</b>${p.id===me?"<br><small>YOU</small>":""}</div>`).join("");$("start").disabled=state.players.length<2;$("wmsg").textContent=state.players.length<2?"Waiting for another player…":"Ready to start."}
function showGame(){$("waiting").classList.add("hidden");$("game").classList.remove("hidden");$("gcode").textContent=state.roomId;$("gplayers").innerHTML=state.players.map(p=>`<div class="player"><span class="dot ${p.color}"></span><b>${esc(p.name)}</b></div>`).join("");renderBoard();updateGame()}
function cellEl(r,c){return document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`)}
function renderBoard(){
 const b=$("board");b.innerHTML="";
 const homeInfo=[["red",0,0],["green",0,9],["blue",9,0],["yellow",9,9]];
 for(let r=0;r<15;r++)for(let c=0;c<15;c++){let x=document.createElement("div");x.className="cell";x.dataset.r=r;x.dataset.c=c;b.appendChild(x)}
 homeInfo.forEach(([color,r,c])=>{let x=cellEl(r,c);x.classList.add("home",color);let yard=document.createElement("div");yard.className="yard";yard.style.color=`var(--${color})`;for(let i=0;i<4;i++)yard.innerHTML+="<i></i>";x.appendChild(yard)})
 pathCells.forEach(([r,c],i)=>{let x=cellEl(r,c);x.classList.add("path");let color=Object.keys(starts).find(k=>starts[k]===i);if(color)x.classList.add(color)});
 Object.entries(lanes).forEach(([color,cells])=>cells.forEach(([r,c])=>cellEl(r,c).classList.add("lane",color)));
 [[7,7]].forEach(([r,c])=>cellEl(r,c).classList.add("center"));
 // re-render pawns
 state.players.forEach(p=>p.pawns&&p.pawns.forEach((pawn,i)=>{if(pawn.pos<0)return;let rc=tokenCoord(p.color,pawn.pos);let cell=cellEl(...rc);let t=document.createElement("div");t.className=`token ${p.color}`;t.textContent=i+1;t.dataset.player=p.id;t.dataset.pawn=i;cell.appendChild(t)}));
}
function tokenCoord(color,pos){if(pos>=52&&pos<=56)return lanes[color][pos-52];if(pos===57)return [7,7];let idx=(starts[color]+pos)%52;return pathCells[idx]}
function updateGame(){let p=state.players[state.game.turn%state.players.length];$("turn").textContent=state.game.winner?"GAME OVER":p.color.toUpperCase()+"'S TURN";$("die").textContent=state.game.dice??"–";$("status").textContent=state.game.winner?`${state.players.find(x=>x.id===state.game.winner)?.name} wins!`:p.id===me?(state.game.dice?"Choose a highlighted pawn.":"Roll the dice."):`Waiting for ${p.name}…`;$("roll").disabled=p.id!==me||state.game.dice!==null||!!state.game.winner;document.querySelectorAll(".token").forEach(t=>{if(t.dataset.player===me&&state.game.dice!==null)t.classList.add("movable")});document.querySelectorAll(".token.movable").forEach(t=>t.onclick=()=>send("move",{pawnId:Number(t.dataset.pawn)}))}
