const express=require("express"),http=require("http"),path=require("path"),{WebSocketServer}=require("ws");
const app=express(),server=http.createServer(app),wss=new WebSocketServer({server});
app.use(express.static(__dirname)); app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));
const rooms=new Map(), colors=["red","green","yellow","blue"];
const starts={red:0,green:13,yellow:26,blue:39};
const send=(w,m)=>w.readyState===1&&w.send(JSON.stringify(m));
const code=()=>{let c;do c=Math.random().toString(36).slice(2,7).toUpperCase();while(rooms.has(c));return c};
function game(){return{turn:0,dice:null,mustMove:false,winner:null,pawns:[]}}
function initPawns(n){return Array.from({length:n},(_,i)=>({id:i,pos:-1}))}
function state(r){return{roomId:r.id,players:r.players.map(p=>({id:p.id,name:p.name,color:p.color})),started:r.started,game:r.game}}
function broadcast(r,m){r.players.forEach(p=>send(p.ws,m))}
function current(r){return r.players[r.game.turn%r.players.length]}
function globalIndex(color,pos){return (starts[color]+pos)%52}
function canMove(pawn,d){if(pawn.pos===57)return false;if(pawn.pos===-1)return d===6;return pawn.pos+d<=57}
function movePawn(r,player,pawnId){
 const d=r.game.dice,pawns=r.game.pawns[player.id],pawn=pawns[pawnId];
 if(!d||!canMove(pawn,d)) return false;
 if(pawn.pos===-1)pawn.pos=0; else pawn.pos+=d;
 // capture an opponent on the shared track (simple safe squares omitted)
 if(pawn.pos>=0&&pawn.pos<52){
   const gi=globalIndex(player.color,pawn.pos);
   r.players.forEach(op=>{if(op.id===player.id)return;op.pawns.forEach(q=>{if(q.pos>=0&&q.pos<52&&globalIndex(op.color,q.pos)===gi)q.pos=-1})});
 }
 if(r.players.every(q=>r.game.pawns[q.id].every(x=>x.pos===57)))r.game.winner=player.id;
 r.game.dice=null;r.game.mustMove=false;
 if(pawn.pos!==57 && d===6 && !r.game.winner){} else r.game.turn=(r.game.turn+1)%r.players.length;
 return true
}
wss.on("connection",ws=>{
 ws.id=Math.random().toString(36).slice(2);
 ws.on("message",raw=>{let m;try{m=JSON.parse(raw)}catch{return}
  if(m.type==="create"||m.type==="join"){
   const id=m.type==="create"?code():String(m.roomId||"").toUpperCase();let r=rooms.get(id);
   if(m.type==="join"&&!r)return send(ws,{type:"error",message:"Room not found."});
   if(!r){r={id,players:[],started:false,game:null};rooms.set(id,r)}
   if(r.started)return send(ws,{type:"error",message:"Game already started."});
   if(r.players.length>=4)return send(ws,{type:"error",message:"Room is full."});
   const p={ws,id:ws.id,name:String(m.name||"Player").slice(0,16),color:colors[r.players.length],pawns:[]};r.players.push(p);ws.room=id;
   send(ws,{type:"joined",selfId:ws.id,state:state(r)});broadcast(r,{type:"state",state:state(r)});return;
  }
  const r=rooms.get(ws.room);if(!r)return;
  if(m.type==="start"){if(r.players.length<2)return send(ws,{type:"error",message:"At least 2 players are needed."});
   r.started=true;r.game=game();r.players.forEach(p=>{p.pawns=initPawns(4);r.game.pawns.push(p.pawns)});broadcast(r,{type:"state",state:state(r)});return}
  if(m.type==="roll"){
   if(!r.started||r.game.dice||r.game.winner)return;
   const p=current(r);if(p.id!==ws.id)return;
   const d=1+Math.floor(Math.random()*6),pp=r.game.pawns[p.id];
   r.game.dice=d;
   const movable=pp.some(x=>canMove(x,d));
   if(!movable){r.game.dice=null;r.game.turn=(r.game.turn+1)%r.players.length}
   broadcast(r,{type:"state",state:state(r)});return
  }
  if(m.type==="move"){
   if(!r.started||r.game.dice===null||r.game.winner)return;
   const p=current(r);if(p.id!==ws.id)return;
   if(!movePawn(r,p,Number(m.pawnId)))return send(ws,{type:"error",message:"That pawn cannot move."});
   broadcast(r,{type:"state",state:state(r)})
  }
 });
 ws.on("close",()=>{const r=rooms.get(ws.room);if(!r)return;r.players=r.players.filter(p=>p.ws!==ws);if(!r.players.length)rooms.delete(r.id);else broadcast(r,{type:"state",state:state(r)})})
});
server.listen(process.env.PORT||3000,"0.0.0.0",()=>console.log("Ludo Royale online"));
