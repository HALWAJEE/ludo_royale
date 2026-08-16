const $=id=>document.getElementById(id);
const board=$("board"), playersEl=$("players"), statusEl=$("status"), rollBtn=$("roll"), startBtn=$("start");
const die=$("dice"), modal=$("modal"), modalError=$("modalError");
const roomCodeEl=$("roomCode"), turnBadge=$("turnBadge");
const faces=["","⚀","⚁","⚂","⚃","⚄","⚅"];
const colors=["red","green","yellow","blue"];
let state=null,selfId=null,roomId=null,pendingRoll=null;
const socket=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host);

const TRACK=[
 [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],
 [0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
 [7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
 [14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
 [7,0],[6,0]
];
const OFF={red:0,green:13,yellow:26,blue:39};
const HOME={
 red:[[1.65,1.65],[4.35,1.65],[1.65,4.35],[4.35,4.35]],
 green:[[10.65,1.65],[13.35,1.65],[10.65,4.35],[13.35,4.35]],
 yellow:[[10.65,10.65],[13.35,10.65],[10.65,13.35],[13.35,13.35]],
 blue:[[1.65,10.65],[4.35,10.65],[1.65,13.35],[4.35,13.35]]
};
const LANE={
 red:[[6,1],[6,2],[6,3],[6,4],[6,5]],
 green:[[1,8],[2,8],[3,8],[4,8],[5,8]],
 yellow:[[8,13],[8,12],[8,11],[8,10],[8,9]],
 blue:[[13,6],[12,6],[11,6],[10,6],[9,6]]
};
const SAFE=new Set([0,8,13,21,26,34,39,47]);

function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function send(x){if(socket.readyState===1)socket.send(JSON.stringify(x))}

function svgEl(tag,attrs={}){
 const e=document.createElementNS("http://www.w3.org/2000/svg",tag);
 Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));
 return e;
}
function cellRect(r,c,fill="#fff"){
 const x=c*40,y=r*40;
 return svgEl("rect",{x,y,width:40,height:40,fill,stroke:"#777","stroke-width":1});
}
function drawBoard(){
 board.innerHTML="";
 const svg=svgEl("svg",{viewBox:"0 0 600 600",preserveAspectRatio:"xMidYMid meet"});
 svg.appendChild(svgEl("rect",{x:0,y:0,width:600,height:600,fill:"#fff"}));
 const fills={red:"#ef2028",green:"#06b52b",yellow:"#ffe100",blue:"#16a9e8"};
 const corners={red:[0,0],green:[9,0],yellow:[9,9],blue:[0,9]};
 // Four colored 6x6 bases.
 for(const [cl,[cx,cy]] of Object.entries(corners)){
   svg.appendChild(svgEl("rect",{x:cx*40,y:cy*40,width:240,height:240,fill:fills[cl]}));
   svg.appendChild(svgEl("rect",{x:(cx+1)*40,y:(cy+1)*40,width:160,height:160,fill:"#fff",stroke:"#555","stroke-width":2}));
   HOME[cl].forEach(([gx,gy])=>{
     svg.appendChild(svgEl("circle",{cx:gx*40,cy:gy*40,r:22,fill:fills[cl],stroke:"#222","stroke-width":1.5}));
   });
 }
 // All 15x15 grid cells in the playable cross.
 const inCross=(r,c)=>(r>=6&&r<=8)||(c>=6&&c<=8);
 for(let r=0;r<15;r++)for(let c=0;c<15;c++){
   if(!inCross(r,c))continue;
   let fill="#fff";
   const idx=TRACK.findIndex(p=>p[0]===r&&p[1]===c);
   if(idx>=0)fill=idx%13===0?Object.values(fills)[Math.floor(idx/13)]: "#fff";
   svg.appendChild(cellRect(r,c,fill));
 }
 // Repaint colored entry squares and home lanes.
 const pathColorAt=(cl)=>{
   const col=fills[cl];
   const coords=LANE[cl];
   coords.forEach(([r,c])=>svg.appendChild(cellRect(r,c,col)));
 };
 pathColorAt("red");pathColorAt("green");pathColorAt("yellow");pathColorAt("blue");
 // Start squares.
 [[0,"red"],[13,"green"],[26,"yellow"],[39,"blue"]].forEach(([idx,cl])=>{
   const [r,c]=TRACK[idx];svg.appendChild(cellRect(r,c,fills[cl]));
 });
 // Center: four triangles.
 const cx=300,cy=300;
 const pts={red:`${cx},${cy} 240,240 240,360`,green:`${cx},${cy} 240,240 360,240`,yellow:`${cx},${cy} 360,240 360,360`,blue:`${cx},${cy} 240,360 360,360`};
 for(const [cl,p] of Object.entries(pts))svg.appendChild(svgEl("polygon",{points:p,fill:fills[cl],stroke:"#555","stroke-width":1}));
 // Token layer.
 svg.appendChild(svgEl("g",{id:"tokens"}));
 board.appendChild(svg);
}
drawBoard();

function coordFor(cl,progress){
 if(progress<0)return HOME[cl][0];
 if(progress<51){
   const idx=(OFF[cl]+progress)%52;
   const [r,c]=TRACK[idx];return [c+.5,r+.5];
 }
 if(progress<56){
   const [r,c]=LANE[cl][progress-51];return [c+.5,r+.5];
 }
 return [7.5,7.5];
}
function render(){
 if(!state)return;
 roomCodeEl.textContent=`ROOM ${state.roomId}`;
 const current=state.players[state.game?.turn??0];
 turnBadge.textContent=current?`${current.color.toUpperCase()}'S TURN`:"WAITING";
 playersEl.innerHTML=state.players.map(p=>`<div class="player ${current&&p.id===current.id?"active":""}">
 <span class="dot ${p.color}"></span><span class="player-name">${esc(p.name)}</span>${p.id===selfId?'<span class="you">YOU</span>':""}</div>`).join("");
 startBtn.disabled=state.players.length<2||state.started;
 rollBtn.disabled=!state.started||!current||current.id!==selfId||pendingRoll!==null;
 statusEl.textContent=!state.started
   ? (state.players.length<2?"Waiting for at least 2 players…":"Everyone is here — start the game.")
   : current?.id===selfId
     ? (pendingRoll===null?"Your turn — roll the dice!":"Choose a highlighted pawn.")
     : `Waiting for ${current?.name||"player"}…`;
 renderTokens();
}
function renderTokens(){
 const svg=board.querySelector("svg"),g=svg.querySelector("#tokens");
 g.innerHTML="";
 if(!state)return;
 state.players.forEach(p=>{
   p.tokens.forEach((progress,i)=>{
     const [x,y]=coordFor(p.color,progress);
     const token=svgEl("g",{class:"pawn"+(pendingRoll&&pendingRoll.playerId===p.id&&pendingRoll.legal.includes(i)?" selectable":""),transform:`translate(${x*40},${y*40})`});
     token.dataset.index=i;token.dataset.player=p.id;
     token.appendChild(svgEl("circle",{cx:0,cy:0,r:15,fill:{red:"#ef2028",green:"#06b52b",yellow:"#ffe100",blue:"#16a9e8"}[p.color],stroke:"#fff","stroke-width":3}));
     token.appendChild(svgEl("circle",{cx:0,cy:-4,r:5,fill:"#fff",opacity:.35}));
     token.appendChild(svgEl("text",{x:0,y:5,"text-anchor":"middle","font-size":11,"font-weight":900,fill:p.color==="yellow"?"#222":"#fff"})).textContent=i+1;
     if(p.id===selfId&&pendingRoll&&pendingRoll.legal.includes(i)) token.addEventListener("click",()=>move(i));
     g.appendChild(token);
   });
 });
}
function move(i){
 if(!pendingRoll)return;
 send({type:"move",token:i});
 pendingRoll=null;render();
}
function animateDice(final){
 die.classList.add("rolling");
 let n=0;
 const timer=setInterval(()=>{
   n++;die.querySelector("span").textContent=faces[1+Math.floor(Math.random()*6)];
   if(n>12){clearInterval(timer);die.classList.remove("rolling");die.querySelector("span").textContent=faces[final];}
 },70);
}
rollBtn.onclick=()=>send({type:"roll"});
die.onclick=()=>{if(!rollBtn.disabled)send({type:"roll"})};
startBtn.onclick=()=>send({type:"start"});
$("create").onclick=()=>{const name=$("name").value.trim()||"Player";send({type:"create",name})};
$("join").onclick=()=>{const name=$("name").value.trim()||"Player",code=$("joinCode").value.trim().toUpperCase();if(code.length!==5){modalError.textContent="Enter the 5-letter room code.";return}send({type:"join",roomId:code,name})};

socket.onopen=()=>statusEl.textContent="Connected. Create or join a room.";
socket.onmessage=e=>{
 const m=JSON.parse(e.data);
 if(m.type==="error"){modalError.textContent=m.message;return}
 if(m.type==="joined"){selfId=m.selfId;roomId=m.state.roomId;state=m.state;modal.classList.add("hidden");render();return}
 if(m.type==="state"){
   const old=state?.game?.dice,newDice=m.state.game?.dice;
   state=m.state;roomId=state.roomId;
   if(newDice&&newDice!==old)animateDice(newDice);
   render();
 }
 if(m.type==="rollResult"){
   pendingRoll=m;
   animateDice(m.dice);
   render();
 }
};
socket.onclose=()=>statusEl.textContent="Connection lost — refresh to reconnect.";
