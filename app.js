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
let ws=null, selfId=null, state=null, moving=false, diceTimer=null, audioCtx=null, noiseBuffer=null, soundEnabled=true, animatingPawn=null;
let reconnectTimer=null, reconnectAttempts=0, intentionalClose=false;
let resumeToken=localStorage.getItem('ludoResumeToken')||'';
let savedRoomId=localStorage.getItem('ludoRoomId')||'';
let actionQueue=[];

/* ---------- lightweight game audio: no external files needed ---------- */
function ensureAudio(){
  if(!soundEnabled)return null;
  if(!audioCtx){
    const C=window.AudioContext||window.webkitAudioContext;
    if(!C)return null;
    audioCtx=new C();
    const len=Math.floor(audioCtx.sampleRate*.35);
    noiseBuffer=audioCtx.createBuffer(1,len,audioCtx.sampleRate);
    const data=noiseBuffer.getChannelData(0);
    for(let i=0;i<len;i++)data[i]=Math.random()*2-1;
  }
  if(audioCtx.state==='suspended')audioCtx.resume();
  return audioCtx;
}
function tone(freq,duration=.12,type='sine',gain=.035,when=0,slideTo=null){
  const c=ensureAudio(); if(!c)return;
  const t=c.currentTime+when, o=c.createOscillator(), g=c.createGain();
  o.type=type;o.frequency.setValueAtTime(freq,t);if(slideTo)o.frequency.exponentialRampToValueAtTime(Math.max(30,slideTo),t+duration);
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(gain,t+.012);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
  o.connect(g).connect(c.destination);o.start(t);o.stop(t+duration+.02);
}
function noiseBurst(duration=.12,gain=.035,filter=1400,when=0){
  const c=ensureAudio();if(!c||!noiseBuffer)return;
  const t=c.currentTime+when,s=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();
  s.buffer=noiseBuffer;f.type='bandpass';f.frequency.setValueAtTime(filter,t);f.Q.value=.8;
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(gain,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
  s.connect(f).connect(g).connect(c.destination);s.start(t);s.stop(t+duration+.02);
}
function soundDice(){
  if(!soundEnabled)return;
  ensureAudio();
  for(let i=0;i<5;i++){noiseBurst(.09,.026,900+i*420,i*.055);tone(130+i*25,.07,'triangle',.018,i*.055,220+i*35);}
}
function soundStep(){
  if(!soundEnabled)return;
  ensureAudio();
  noiseBurst(.075,.018,1250,0);
  tone(155,.11,'sine',.035,0,105);
  tone(90,.08,'sine',.016,.015,70);
}
function soundStar(){
  if(!soundEnabled)return;
  ensureAudio();
  tone(660,.16,'sine',.035,0,760);tone(880,.22,'sine',.03,.09,990);
}
function soundCapture(){
  if(!soundEnabled)return;
  ensureAudio();
  tone(310,.16,'triangle',.035,0,250);tone(220,.22,'triangle',.03,.11,150);noiseBurst(.16,.012,650,.04);
}
function soundWin(){
  if(!soundEnabled)return;
  ensureAudio();
  [523,659,784,1047].forEach((f,i)=>tone(f,.18,'sine',.035,i*.09));
}
function unlockAudio(){if(soundEnabled)ensureAudio()}
document.addEventListener('pointerdown',unlockAudio,{once:true});
const soundBtn=$('#soundBtn');
if(soundBtn){
  soundBtn.onclick=()=>{
    soundEnabled=!soundEnabled;
    soundBtn.innerHTML=soundEnabled?'🔊 <span>SOUND ON</span>':'🔇 <span>SOUND OFF</span>';
    if(soundEnabled)ensureAudio();
  };
}


function socketURL(){
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}
function setConnectionNotice(text){
  const target = state?.game?.started ? gameMsg : lobbyMsg;
  if(target) target.textContent=text;
}
function scheduleReconnect(){
  if(intentionalClose || reconnectTimer) return;
  const delay=Math.min(10000, 600*Math.pow(1.6, reconnectAttempts++));
  setConnectionNotice('Connection interrupted — reconnecting…');
  reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect();},delay);
}
function connect(){
  if(ws && (ws.readyState===WebSocket.OPEN || ws.readyState===WebSocket.CONNECTING)) return;
  try { ws = new WebSocket(socketURL()); } catch { scheduleReconnect(); return; }
  ws.onopen = () => {
    reconnectAttempts=0;
    createBtn.disabled=false; joinBtn.disabled=false;
    if(savedRoomId && resumeToken){
      ws.send(JSON.stringify({type:'resume',roomId:savedRoomId,token:resumeToken}));
      setConnectionNotice('Reconnected — syncing game…');
    } else {
      lobbyMsg.textContent='Connected.';
      flushActions();
    }
  };
  ws.onmessage = e => { try { handle(JSON.parse(e.data)); } catch(err){ console.error(err); } };
  ws.onerror = () => {};
  ws.onclose = () => scheduleReconnect();
}
function flushActions(){
  if(!ws || ws.readyState!==WebSocket.OPEN) return;
  const q=actionQueue.splice(0);
  q.forEach(msg=>ws.send(JSON.stringify(msg)));
}
function send(msg){
  if(!ws || ws.readyState!==WebSocket.OPEN){
    actionQueue.push(msg);
    connect();
    scheduleReconnect();
    return;
  }
  ws.send(JSON.stringify(msg));
}
function validName(){
  const n=nameInput.value.trim();
  if(!n){lobbyMsg.textContent='Please enter your name.'; nameInput.focus(); return null}
  return n;
}
createBtn.onclick=()=>{unlockAudio();const n=validName(); if(!n)return; lobbyMsg.textContent='Creating room…'; send({type:'create',name:n});};
joinBtn.onclick=()=>{unlockAudio();const n=validName(); if(!n)return; const code=roomInput.value.trim().toUpperCase(); if(code.length!==5){lobbyMsg.textContent='Enter the 5-character room code.';return} lobbyMsg.textContent='Joining room…'; send({type:'join',name:n,roomId:code});};
startBtn.onclick=()=>{unlockAudio();send({type:'start'});};
$('#copyBtn').onclick=async()=>{unlockAudio();try{await navigator.clipboard.writeText($('#roomCode').textContent);roomMsg.textContent='Room code copied!';}catch{roomMsg.textContent='Room code: '+$('#roomCode').textContent}};
$('#rollBtn').onclick=()=>{
  if(moving) return;
  unlockAudio();moving=true;$('#rollBtn').disabled=true;$('#diceStatus').textContent='ROLLING';$('#dice').classList.add('rolling');$('#dice').dataset.value='0';send({type:'roll'});
  setTimeout(()=>{if(!state?.game?.awaitingMove)moving=false;},1250);
};

function handle(m){
  if(m.type==='error'){ (gameScreen.classList.contains('hidden')?lobbyMsg:gameMsg).textContent=m.message; moving=false; return; }
  if(m.type==='joined'){
    selfId=m.selfId; state=m.state; resumeToken=m.resumeToken||resumeToken; savedRoomId=state.roomId;
    localStorage.setItem('ludoResumeToken',resumeToken); localStorage.setItem('ludoRoomId',savedRoomId);
    actionQueue=[]; showRoom(); return;
  }
  if(m.type==='resumed'){
    selfId=m.selfId; state=m.state; resumeToken=m.resumeToken||resumeToken; savedRoomId=state.roomId;
    localStorage.setItem('ludoResumeToken',resumeToken); localStorage.setItem('ludoRoomId',savedRoomId);
    moving=false; animatingPawn=null; if(state.game?.started) showGame(); else showRoom(); render();
    setTimeout(()=>{ if(gameMsg) gameMsg.textContent='Connection restored.'; },0);
    flushActions(); return;
  }
  if(m.type==='resume_failed'){
    resumeToken=''; savedRoomId=''; localStorage.removeItem('ludoResumeToken'); localStorage.removeItem('ludoRoomId');
    if(state?.game?.started) gameMsg.textContent='Unable to restore this room. Please rejoin.';
    else lobbyMsg.textContent='Previous room expired. Please create or join again.';
    return;
  }
  if(m.type==='state'){
    const prevDice=state?.game?.dice;
    state=m.state;
    if(state.game?.dice && state.game.dice!==prevDice){ $('#dice').classList.add('rolling'); soundDice(); }
    if(state.game?.started) showGame(); else showRoom(); render(); return;
  }
  if(m.type==='move'){animateMove(m); return;}
}
function showRoom(){lobby.classList.add('hidden'); gameScreen.classList.add('hidden'); roomScreen.classList.remove('hidden'); renderRoom();}
function showGame(){lobby.classList.add('hidden'); roomScreen.classList.add('hidden'); gameScreen.classList.remove('hidden'); render();}
function renderRoom(){
  if(!state)return;
  $('#roomCode').textContent=state.roomId;
  startBtn.classList.toggle('hidden', !(state.hostId===selfId && state.players.length>=2));
  $('#roomPlayers').innerHTML=state.players.map(p=>`<div class="room-player"><i class="dot" style="background:var(--${p.color})"></i><span>${escapeHtml(p.name)}</span>${p.id===state.hostId?'<small>HOST</small>':''}</div>`).join('');
}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function cellKey(r,c){return `${r},${c}`}
function buildBoard(){
  const b=$('#board'); b.innerHTML='';
  const pathMap=new Map(path.map((p,i)=>[cellKey(...p),i]));
  const laneMap=new Map(); Object.entries(lanes).forEach(([c,a])=>a.forEach((p,i)=>laneMap.set(cellKey(...p),[c,i])));
  for(let r=0;r<15;r++)for(let c=0;c<15;c++){
    const el=document.createElement('div'); el.className='cell'; el.dataset.rc=cellKey(r,c); const k=cellKey(r,c);
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
  const centerArt=document.createElement('div'); centerArt.className='center-art';
  ['green','red','yellow','blue'].forEach(c=>{const t=document.createElement('div');t.className=`tri ${c}`;centerArt.appendChild(t);});
  b.appendChild(centerArt);
}
function pawnCoord(pi,pos){
  if(pos===0||pos===58)return null;
  if(pos<=52){const gi=(starts[pi]+pos-1)%52;return path[gi]}
  return lanes[colors[pi]][pos-53];
}
function pawnEl(pi,pawn,pos,selectable){
  const p=document.createElement('div'); p.className=`pawn ${colors[pi]}${selectable?' selectable':''}`; p.dataset.player=pi; p.dataset.pawn=pawn;
  if(selectable){p.onclick=()=>{unlockAudio();send({type:'move',pawn});};}
  return p;
}
function stackLayout(count,index){
  const layouts={
    1:[[50,50]],
    2:[[33,50],[67,50]],
    3:[[34,34],[66,34],[50,67]],
    4:[[34,34],[66,34],[34,66],[66,66]]
  };
  const a=layouts[Math.min(count,4)]||layouts[4];
  return a[index%a.length];
}
function addStackPawn(cell,item,count,index){
  const p=pawnEl(item.pi,item.pawn,item.pos,item.selectable);
  p.classList.add('stacked-pawn');
  const [x,y]=stackLayout(count,index);
  p.style.left=x+'%'; p.style.top=y+'%';
  const size=count===1?'58%':'43%';
  p.style.width=size; p.style.height=size;
  p.style.transform='translate(-50%,-50%)';
  p.style.zIndex=30+index;
  if(item.selectable){
    const ring=document.createElement('div');
    ring.className='stack-ring';
    ring.style.color=`var(--${colors[item.pi]})`;
    ring.style.left=x+'%'; ring.style.top=y+'%';
    ring.style.width=count===1?'68%':'50%'; ring.style.height=count===1?'68%':'50%';
    ring.style.zIndex=20+index; cell.appendChild(ring);
  }
  cell.appendChild(p);
}
function renderPawns(){
  document.querySelectorAll('.board .pawn,.board .glow-ring,.board .stack-ring').forEach(x=>x.remove());
  if(!state?.game)return;
  const turn=state.game.turn;
  const myIdx=state.players.findIndex(p=>p.id===selfId);
  const dice=state.game.dice;
  const groups=new Map();

  state.game.pawns.forEach((arr,pi)=>arr.forEach((pos,pawn)=>{
    if(animatingPawn && animatingPawn.pi===pi && animatingPawn.pawn===pawn)return;
    const selectable=pi===myIdx && pi===turn && state.game.awaitingMove && validClientMove(pos,dice);
    if(pos===0){
      const home=document.querySelector(`.home-box.${colors[pi]}`);
      const slot=home?.children[pawn];
      if(slot){
        if(selectable){
          const ring=document.createElement('div'); ring.className='glow-ring';
          ring.style.color=`var(--${colors[pi]})`; slot.appendChild(ring);
        }
        slot.appendChild(pawnEl(pi,pawn,pos,selectable));
      }
      return;
    }
    const rc=pos===58?[7,7]:pawnCoord(pi,pos);
    if(!rc)return;
    const cell=document.querySelector(`.cell[data-rc="${rc[0]},${rc[1]}"]`);
    if(!cell)return;
    const key=`${rc[0]},${rc[1]}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({pi,pawn,pos,selectable,cell});
  }));

  groups.forEach(group=>group.forEach((item,index)=>addStackPawn(item.cell,item,group.length,index)));
}
function validClientMove(pos,dice){if(!dice)return false;if(pos===58)return false;if(pos===0)return dice===6;return pos+dice<=58}
function render(){if(!state)return;if(state.game?.started){$('#gameRoom').textContent=state.roomId;renderPlayers();renderTurn();buildBoard();renderPawns();renderDice();}}
function renderPlayers(){const my=state.players.findIndex(p=>p.id===selfId);$('#players').innerHTML=state.players.map((p,i)=>{const homes=state.game.pawns[i]?.filter(x=>x===58).length||0;return `<div class="player-row ${i===state.game.turn?'current':''}"><i class="dot" style="background:var(--${p.color})"></i><span>${escapeHtml(p.name)}</span><span class="meta">${homes}/4 HOME${i===my?' · YOU':''}</span></div>`}).join('')}
function renderTurn(){
  const p=state.players[state.game.turn],my=p?.id===selfId;
  $('#turnBadge').innerHTML=`<span class="turn-light"></span>${p?`${p.color.toUpperCase()}'S TURN`:'WAITING'}`;
  $('#turnBadge').classList.toggle('active',!!my);
  $('#diceHint').textContent=state.game.winner!=null?`${state.players[state.game.winner].name} wins!`:my?(state.game.awaitingMove?'Choose a highlighted pawn.':'Your turn — roll the dice.'):`${p?.name||'Opponent'}'s turn — waiting for their move.`;
  $('#gameMsg').textContent=state.game.lastAction||'';
  const chip=$('#activePlayerChip');
  if(chip&&p){ chip.innerHTML=`<span class="dot" style="background:var(--${p.color})"></span><span>${my?'YOUR TURN':p.color.toUpperCase()+' TURN'}</span>`; chip.classList.toggle('mine',my); }
}
function renderDice(){
  const d=$('#dice'),value=state.game.dice||0,my=state.players[state.game.turn]?.id===selfId;
  if(value&&d.classList.contains('rolling')){clearTimeout(diceTimer);diceTimer=setTimeout(()=>{d.classList.remove('rolling');d.dataset.value=String(value);$('#diceStatus').textContent=`ROLLED ${value}`;},650);}
  else if(!value){d.classList.remove('rolling');d.dataset.value='0';$('#diceStatus').textContent='READY';}
  else{d.dataset.value=String(value);$('#diceStatus').textContent=`ROLLED ${value}`;}
  $('#rollBtn').disabled=!my||state.game.awaitingMove||state.game.winner!=null||moving;
}
function boardPoint(pi,pos,pawn){
  const board=$('#board');if(!board)return null;const br=board.getBoundingClientRect();let target=null;
  if(pos===0){const home=document.querySelector(`.home-box.${colors[pi]}`);target=home?.children[pawn];}
  else if(pos===58)target=document.querySelector('.cell[data-rc="7,7"]');
  else{const rc=pawnCoord(pi,pos);target=document.querySelector(`.cell[data-rc="${rc[0]},${rc[1]}"]`);}
  if(!target)return null;const r=target.getBoundingClientRect();return {x:r.left-br.left+r.width/2,y:r.top-br.top+r.height/2};
}
function createMotionPawn(pi){
  const board=$('#board'),p=document.createElement('div'); p.className=`pawn ${colors[pi]} motion-pawn`; board.appendChild(p);
  const cell=board.querySelector('.cell');
  if(cell){const r=cell.getBoundingClientRect(); const size=Math.max(16,Math.min(36,r.width*0.68)); p.style.width=`${size}px`; p.style.height=`${Math.max(20,size*1.22)}px`;}
  return p;
}
function setMotionPoint(el,point){if(!point)return;el.style.left=`${point.x}px`;el.style.top=`${point.y}px`;}
function animateMove(m){
  const finalState=JSON.parse(JSON.stringify(m.state));
  const pi=m.player, pawn=m.pawn, from=m.from, to=m.to;
  moving=true; $('#rollBtn').disabled=true;

  // Keep exactly one visual copy of the moving pawn during the animation.
  const startState=JSON.parse(JSON.stringify(finalState));
  startState.game.pawns[pi][pawn]=from;
  state=startState;
  animatingPawn={pi,pawn};
  render();

  const start=boardPoint(pi,from,pawn);
  const end=boardPoint(pi,to,pawn);
  if(!start||!end){finishMove();return;}

  const motion=createMotionPawn(pi);
  motion.style.transition='none';
  motion.style.willChange='left,top,transform';
  setMotionPoint(motion,start);

  const points=[];
  // The motion pawn is already positioned at the home slot when leaving base.
  // Start directly with square 1 so it never visually re-teleports to its base.
  for(let pos=Math.max(1,from+1);pos<=to;pos++){
    const pt=boardPoint(pi,pos,pawn); if(pt)points.push(pt);
  }
  if(to===58 && points.length===0)points.push(end);
  if(points.length && points[points.length-1].x!==end.x || points.length && points[points.length-1].y!==end.y) points.push(end);

  let index=0;
  let fromPoint=start;
  let segmentStart=performance.now();
  const duration=165;
  let landedSound=false;

  function frame(now){
    if(index>=points.length){finishMove();return;}
    const target=points[index];
    const t=Math.min(1,(now-segmentStart)/duration);
    const eased=t<.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;
    const x=fromPoint.x+(target.x-fromPoint.x)*eased;
    const y=fromPoint.y+(target.y-fromPoint.y)*eased;
    const lift=Math.sin(Math.PI*t)*Math.min(9,Math.max(5,target.y-fromPoint.y?7:6));
    const sx=1+0.06*Math.sin(Math.PI*t), sy=1-0.06*Math.sin(Math.PI*t);
    motion.style.left=x+'px'; motion.style.top=y+'px';
    motion.style.transform=`translate3d(-50%,-50%,0) translateY(${-lift}px) scale(${sx},${sy})`;
    if(t>=1){
      motion.style.left=target.x+'px'; motion.style.top=target.y+'px';
      motion.style.transform='translate3d(-50%,-50%,0) scale(1)';
      if(index>0 || from!==0) soundStep();
      fromPoint=target; index++; segmentStart=now; landedSound=false;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function finishMove(){
    if(motion&&motion.parentNode)motion.remove();
    animatingPawn=null; state=finalState; moving=false; render();
    if(m.captured?.length)soundCapture();
    if(to!==58 && to>=1 && to<=52){
      const landed=(starts[pi]+to-1)%52;
      if(safe.has(landed)){
        const cell=document.querySelector(`.cell[data-rc="${path[landed][0]},${path[landed][1]}"]`);
        cell?.classList.add('star-landed'); setTimeout(()=>cell?.classList.remove('star-landed'),700); soundStar();
      }
    }
    if(finalState.game.winner!=null)soundWin();
  }
}

buildBoard();connect();
