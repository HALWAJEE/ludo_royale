const express=require("express");
const http=require("http");
const path=require("path");
const {WebSocketServer}=require("ws");
const app=express(),server=http.createServer(app),wss=new WebSocketServer({server});
app.use(express.static(__dirname));app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));
const rooms=new Map(),COLORS=["red","green","yellow","blue"],OFF={red:0,green:13,yellow:26,blue:39};
const SAFE=new Set([0,8,13,21,26,34,39,47]);
const send=(ws,x)=>ws.readyState===1&&ws.send(JSON.stringify(x));
const broadcast=(r,x)=>r.players.forEach(p=>send(p.ws,x));
const code=()=>{let c;do{c=Math.random().toString(36).slice(2,7).toUpperCase()}while(rooms.has(c));return c};
const snapshot=r=>({roomId:r.id,started:r.started,players:r.players.map(p=>({id:p.id,name:p.name,color:p.color,tokens:p.tokens})) ,game:r.game});

function trackIndex(color,progress){return (OFF[color]+progress)%52}
function canMove(p,token,dice){
 const pos=p.tokens[token];
 if(pos===56)return false;
 if(pos===-1)return dice===6;
 return pos+dice<=56;
}
function landing(color,progress){return progress<51?trackIndex(color,progress):null}
function capture(r,mover,token){
 const pos=mover.tokens[token];
 const idx=landing(mover.color,pos);
 if(idx===null||SAFE.has(idx))return;
 r.players.forEach(p=>{
   if(p.id===mover.id)return;
   p.tokens=p.tokens.map(t=>{
     const other=landing(p.color,t);
     return other!==null&&other===idx?-1:t;
   });
 });
}
function nextTurn(r,extra=false){if(!extra)r.game.turn=(r.game.turn+1)%r.players.length}
function hasLegal(p,dice){return p.tokens.some((_,i)=>canMove(p,i,dice))}
wss.on("connection",ws=>{
 ws.id=Math.random().toString(36).slice(2);
 ws.on("message",raw=>{
   let m;try{m=JSON.parse(raw)}catch{return}
   if(m.type==="create"||m.type==="join"){
     const id=m.type==="create"?code():String(m.roomId||"").toUpperCase();let r=rooms.get(id);
     if(m.type==="join"&&!r)return send(ws,{type:"error",message:"Room not found."});
     if(!r){r={id,players:[],started:false,game:null};rooms.set(id,r)}
     if(r.players.length>=4)return send(ws,{type:"error",message:"Room is full."});
     const p={ws,id:ws.id,name:String(m.name||"Player").slice(0,16),color:COLORS[r.players.length],tokens:[-1,-1,-1,-1]};
     r.players.push(p);ws.room=id;
     send(ws,{type:"joined",selfId:ws.id,state:snapshot(r)});return broadcast(r,{type:"state",state:snapshot(r)});
   }
   const r=rooms.get(ws.room);if(!r)return;
   const me=r.players.find(p=>p.id===ws.id);if(!me)return;
   if(m.type==="start"){
     if(r.players.length<2)return send(ws,{type:"error",message:"At least 2 players are needed."});
     r.started=true;r.game={turn:0,dice:null};return broadcast(r,{type:"state",state:snapshot(r)});
   }
   if(m.type==="roll"){
     if(!r.started)return;
     const current=r.players[r.game.turn];if(current.id!==ws.id||r.game.dice!==null)return;
     const dice=Math.floor(Math.random()*6)+1;r.game.dice=dice;
     send(ws,{type:"rollResult",dice});
     const legal=current.tokens.map((_,i)=>canMove(current,i,dice)).map((v,i)=>v?i:-1).filter(i=>i>=0);
     if(!legal.length){r.game.dice=null;nextTurn(r,dice===6);return broadcast(r,{type:"state",state:snapshot(r)})}
     // Leave dice set until the player chooses a token.
     r.game.legal=legal;return broadcast(r,{type:"state",state:snapshot(r)});
   }
   if(m.type==="move"){
     if(!r.started||r.game.dice===null)return;
     const current=r.players[r.game.turn];if(current.id!==ws.id||!r.game.legal.includes(m.token))return;
     const dice=r.game.dice;let pos=current.tokens[m.token];pos=pos===-1?0:pos+dice;current.tokens[m.token]=pos;capture(r,current,m.token);
     if(current.tokens.every(t=>t===56)){r.game.winner=current.id}
     const extra=dice===6;
     r.game.dice=null;r.game.legal=[];
     if(!r.game.winner)nextTurn(r,extra);
     return broadcast(r,{type:"state",state:snapshot(r)});
   }
 });
 ws.on("close",()=>{
   const r=rooms.get(ws.room);if(!r)return;
   r.players=r.players.filter(p=>p.ws!==ws);
   if(!r.players.length)rooms.delete(r.id);
   else{if(r.game&&r.game.turn>=r.players.length)r.game.turn=0;broadcast(r,{type:"state",state:snapshot(r)})}
 });
});
const PORT=process.env.PORT||3000;server.listen(PORT,"0.0.0.0",()=>console.log("Ludo Royale listening on "+PORT));
