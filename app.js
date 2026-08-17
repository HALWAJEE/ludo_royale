const $ = s => document.querySelector(s);
const lobby = $('#lobby'), roomScreen = $('#room'), gameScreen = $('#game');
const nameInput = $('#nameInput'), roomInput = $('#roomInput');
const createBtn = $('#createBtn'), joinBtn = $('#joinBtn'), startBtn = $('#startBtn');
const lobbyMsg = $('#lobbyMsg'), roomMsg = $('#roomMsg'), gameMsg = $('#gameMsg');
const colors = ['red','green','yellow','blue'];
const starts = [0,13,26,39];
const safe = new Set([0,8,13,21,26,34,39,47]);
const path = [
 [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],
 [1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],
 [8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],
 [14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0]
];
const lanes = {
 red:[[7,1],[7,2],[7,3],[7,4],[7,5]], green:[[1,7],[2,7],[3,7],[4,7],[5,7]],
 yellow:[[7,13],[7,12],[7,11],[7,10],[7,9]], blue:[[13,7],[12,7],[11,7],[10,7],[9,7]]
};
const homeSlots = {
 red:[[1,1],[1,4],[4,1],[4,4]], green:[[1,10],[1,13],[4,10],[4,13]],
 blue:[[10,1],[10,4],[13,1],[13,4]], yellow:[[10,10],[10,13],[13,10],[13,13]]
};
let ws=null, selfId=null, state=null, moving=false, diceTimer=null;

function socketURL(){
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}
function connect(){
  if(ws && (ws.readyState===WebSocket.OPEN || ws.readyState===WebSocket.CONNECTING)) return;
  ws = new WebSocket(socketURL());
  ws.onopen = () => {
    createBtn.disabled = false; joinBtn.disabled = false;
    lobbyMsg.textContent = 'Connected.';
    if(window.pendingAction){ const a=window.pendingAction; window.pendingAction=null; ws.send(JSON.stringify(a)); }
  };
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onerror = () => { lobbyMsg.textContent='Connection error. Refresh and try again.'; };
  ws.onclose = () => { if(!state?.game?.started){ lobbyMsg.textContent='Disconnected. Refresh to reconnect.'; } };
}
function send(msg){
  if(!ws || ws.readyState !== WebSocket.OPEN){ window.pendingAction=msg; connect(); return; }
  ws.send(JSON.stringify(msg));
}
function validName(){
  const n=nameInput.value.trim();
  if(!n){lobbyMsg.textContent='Please enter your name.'; nameInput.focus(); return null}
  return n;
}
createBtn.onclick=()=>{const n=validName(); if(!n)return; lobbyMsg.textContent='Creating room…'; send({type:'create',name:n});};
joinBtn.onclick=()=>{const n=validName(); if(!n)return; const code=roomInput.value.trim().toUpperCase(); if(code.length!==5){lobbyMsg.textContent='Enter the 5-character room code.';return} lobbyMsg.textContent='Joining room…'; send({type:'join',name:n,roomId:code});};
startBtn.onclick=()=>send({type:'start'});
$('#copyBtn').onclick=async()=>{try{await navigator.clipboard.writeText($('#roomCode').textContent);roomMsg.textContent='Room code copied!';}catch{roomMsg.textContent='Room code: '+$('#roomCode').textContent}};
$('#rollBtn').onclick=()=>{ if(moving) return; moving=true; $('#rollBtn').disabled=true; $('#dice').classList.add('rolling'); $('#dice').dataset.value='0'; send({type:'roll'}); setTimeout(()=>{moving=false},1200); };

function handle(m){
  if(m.type==='error'){ (gameScreen.classList.contains('hidden')?lobbyMsg:gameMsg).textContent=m.message; return; }
  if(m.type==='joined'){selfId=m.selfId; state=m.state; showRoom(); return;}
  if(m.type==='state'){state=m.state; if(state.game?.started) showGame(); else showRoom(); render(); return;}
  if(m.type==='move'){state=m.state; animateMove(m); return;}
}
function showRoom(){lobby.classList.add('hidden'); gameScreen.classList.add('hidden'); roomScreen.classList.remove('hidden'); renderRoom();}
function showGame(){lobby.classList.add('hidden'); roomScreen.classList.add('hidden'); gameScreen.classList.remove('hidden'); render();}
function renderRoom(){
  if(!state)return; $('#roomCode').textContent=state.roomId; startBtn.classList.toggle('hidden', !(state.hostId===selfId && state.players.length>=2));
  $('#roomPlayers').innerHTML=state.players.map(p=>`<div class="room-player"><i class="dot" style="background:var(--${p.color})"></i><span>${escapeHtml(p.name)}</span>${p.id===state.hostId?'<small>HOST</small>':''}</div>`).join('');
}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function cellKey(r,c){return `${r},${c}`}
function buildBoard(){
  const b=$('#board'); b.innerHTML='';
  const pathMap=new Map(path.map((p,i)=>[cellKey(...p),i]));
  const laneMap=new Map(); Object.entries(lanes).forEach(([c,a])=>a.forEach((p,i)=>laneMap.set(cellKey(...p),[c,i])));
  for(let r=0;r<15;r++)for(let c=0;c<15;c++){
    const el=document.createElement('div'); el.className='cell'; el.dataset.rc=cellKey(r,c);
    const k=cellKey(r,c);
    if(r<6&&c<6) el.classList.add('home-red'); else if(r<6&&c>8) el.classList.add('home-green'); else if(r>8&&c<6) el.classList.add('home-blue'); else if(r>8&&c>8) el.classList.add('home-yellow');
    if(pathMap.has(k)){const i=pathMap.get(k);el.dataset.path=i;if(safe.has(i))el.classList.add('safe');el.classList.add('path'); if(i===0)el.classList.add('start-red'); if(i===13)el.classList.add('start-green');if(i===26)el.classList.add('start-yellow');if(i===39)el.classList.add('start-blue');}
    if(laneMap.has(k)){const [co]=laneMap.get(k);el.classList.add('lane-'+co)}
    if(r>=6&&r<=8&&c>=6&&c<=8){el.classList.add('center'); if(r===6&&c===6)el.classList.add('tri-green'); if(r===6&&c===8)el.classList.add('tri-red'); if(r===8&&c===8)el.classList.add('tri-yellow'); if(r===8&&c===6)el.classList.add('tri-blue');}
    b.appendChild(el);
  }
  Object.entries(homeSlots).forEach(([co,slots])=>{
    const home=document.createElement('div'); home.className=`home-box ${co}`; home.dataset.home=co;
    slots.forEach(()=>{const s=document.createElement('div');s.className='home-slot';home.appendChild(s)});
    const [r,c]=co==='red'?[0,0]:co==='green'?[0,9]:co==='blue'?[9,0]:[9,9];
    home.style.gridRow=`${r+1}/span 6`;home.style.gridColumn=`${c+1}/span 6`;b.appendChild(home);
  });
}
function pawnCoord(pi,pos){
  if(pos===0)return null;
  if(pos===58)return null;
  if(pos<=52){const gi=(starts[pi]+pos-1)%52;return path[gi]}
  return lanes[colors[pi]][pos-53];
}
function pawnEl(pi,pawn,pos,selectable){
  const p=document.createElement('div'); p.className=`pawn ${colors[pi]}${selectable?' selectable':''}`; p.dataset.player=pi;p.dataset.pawn=pawn;
  if(selectable){const ring=document.createElement('div');ring.className='glow-ring';ring.style.color=`var(--${colors[pi]})`;p.appendChild(ring);p.onclick=()=>send({type:'move',pawn});}
  return p;
}
function renderPawns(){
  document.querySelectorAll('.board .pawn,.board .home-box .pawn').forEach(x=>x.remove());
  if(!state?.game)return;
  const turn=state.game.turn; const myIdx=state.players.findIndex(p=>p.id===selfId); const dice=state.game.dice;
  state.game.pawns.forEach((arr,pi)=>arr.forEach((pos,pawn)=>{
    if(pos===0){const home=document.querySelector(`.home-box.${colors[pi]}`); const slot=home?.children[pawn]; if(slot)slot.appendChild(pawnEl(pi,pawn,pos,false));}
    else if(pos===58){const center=document.querySelector('.cell[data-rc="7,7"]'); if(center)center.appendChild(pawnEl(pi,pawn,pos,false));}
    else {const rc=pawnCoord(pi,pos); const cell=document.querySelector(`.cell[data-rc="${rc[0]},${rc[1]}"]`); if(cell){const selectable=pi===myIdx&&pi===turn&&state.game.awaitingMove&&validClientMove(pos,dice); if(selectable){const ring=document.createElement('div');ring.className='glow-ring';ring.style.color=`var(--${colors[pi]})`;cell.appendChild(ring)} const pe=pawnEl(pi,pawn,pos,selectable);cell.appendChild(pe);}}
  }));
}
function validClientMove(pos,dice){if(!dice)return false; if(pos===58)return false;if(pos===0)return dice===6;return pos+dice<=58}
function render(){if(!state)return; if(state.game?.started){$('#gameRoom').textContent=state.roomId;renderPlayers();renderTurn();buildBoard();renderPawns();renderDice();}}
function renderPlayers(){const my=state.players.findIndex(p=>p.id===selfId);$('#players').innerHTML=state.players.map((p,i)=>{const homes=state.game.pawns[i]?.filter(x=>x===58).length||0;return `<div class="player-row ${i===state.game.turn?'current':''}"><i class="dot" style="background:var(--${p.color})"></i><span>${escapeHtml(p.name)}</span><span class="meta">${homes}/4 HOME${i===my?' · YOU':''}</span></div>`}).join('')}
function renderTurn(){const p=state.players[state.game.turn];const my=p?.id===selfId;$('#turnBadge').textContent=p?`${p.color.toUpperCase()}'S TURN`: 'WAITING';$('#diceHint').textContent=state.game.winner!=null?`${state.players[state.game.winner].name} wins!`:my?(state.game.awaitingMove?'Choose a highlighted pawn.':'Your turn — roll the dice.'):`${p?.name||'Opponent'} is thinking…`;$('#gameMsg').textContent=state.game.lastAction||''}
function renderDice(){const d=$('#dice'); const value=state.game.dice||0; const my=state.players[state.game.turn]?.id===selfId; if(value && d.classList.contains('rolling')){ clearTimeout(diceTimer); diceTimer=setTimeout(()=>{d.classList.remove('rolling');d.dataset.value=String(value);},700); } else if(!value){d.classList.remove('rolling');d.dataset.value='0';} else {d.dataset.value=String(value);} $('#rollBtn').disabled=!my||state.game.awaitingMove||state.game.winner!=null||moving;}
function animateMove(m){
  state=m.state; const duration=360; const steps=Math.max(1,Math.abs(m.to-m.from)); let i=0; const pi=m.player,pawn=m.pawn;
  if(m.from===0||m.to===58){render();return}
  moving=true; $('#rollBtn').disabled=true;
  const old=state.game.pawns[pi][pawn]; state.game.pawns[pi][pawn]=m.from;
  render();
  const timer=setInterval(()=>{i++;state.game.pawns[pi][pawn]=Math.min(m.from+i,m.to);renderPawns();if(i>=steps){clearInterval(timer);state.game.pawns[pi][pawn]=old;moving=false;render();}},duration);
}

buildBoard();connect();
