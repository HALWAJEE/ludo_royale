const express=require("express");
const http=require("http");
const path=require("path");
const {WebSocketServer}=require("ws");

const app=express(), server=http.createServer(app), wss=new WebSocketServer({server});
app.use(express.static(__dirname));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));

const colors=["red","green","yellow","blue"];
const START={red:0,green:13,yellow:26,blue:39};
const rooms=new Map();

function send(ws,m){if(ws.readyState===1)ws.send(JSON.stringify(m))}
function broadcast(room,m){room.players.forEach(p=>send(p.ws,m))}
function code(){let c;do c=Math.random().toString(36).slice(2,7).toUpperCase();while(rooms.has(c));return c}
function newGame(){return {started:false,turn:0,dice:null,awaitingMove:false,sixes:0,winner:null}}
function newPawns(){return [{pos:-1},{pos:-1},{pos:-1},{pos:-1}]}
function state(room){return {roomId:room.id,players:room.players.map(p=>({id:p.id,name:p.name,color:p.color,pawns:p.pawns})),game:room.game}}
function nextTurn(room,extra=false){
 if(!extra){room.game.turn=(room.game.turn+1)%room.players.length;room.game.sixes=0}
 room.game.dice=null;room.game.awaitingMove=false;
}
function legal(pawn,dice){if(pawn.pos>=52)return false;if(pawn.pos<0)return dice===6;return pawn.pos+dice<=57}
function globalIndex(color,pos){return (START[color]+pos)%52}
function capture(room,mover,landPos){
 if(landPos<0||landPos>=52)return;
 const g=globalIndex(mover.color,landPos);
 const safe=[0,8,13,21,26,34,39,47];
 if(safe.includes(g))return;
 room.players.forEach(p=>{
  if(p.id===mover.id)return;
  p.pawns.forEach(x=>{if(x.pos>=0&&x.pos<52&&globalIndex(p.color,x.pos)===g)x.pos=-1})
 })
}
function allHome(p){return p.pawns.every(x=>x.pos>=52)}
wss.on("connection",ws=>{
 ws.id=Math.random().toString(36).slice(2);
 ws.on("message",raw=>{
  let m;try{m=JSON.parse(raw)}catch{return}
  if(m.type==="create"||m.type==="join"){
   const id=m.type==="create"?code():String(m.roomId||"").toUpperCase();
   let room=rooms.get(id);
   if(m.type==="join"&&!room)return send(ws,{type:"error",message:"Room not found."});
   if(!room){room={id,players:[],game:newGame()};rooms.set(id,room)}
   if(room.players.length>=4)return send(ws,{type:"error",message:"Room is full."});
   const p={ws,id:ws.id,name:String(m.name||"Player").slice(0,16),color:colors[room.players.length],pawns:newPawns()};
   room.players.push(p);ws.room=id;
   send(ws,{type:"joined",selfId:ws.id,state:state(room)});
   broadcast(room,{type:"state",state:state(room)});
   return;
  }
  const room=rooms.get(ws.room);if(!room)return;
  if(m.type==="start"){
   if(room.players.length<2)return send(ws,{type:"error",message:"At least 2 players are needed."});
   if(room.players[0].id!==ws.id)return;
   room.game=newGame();room.game.started=true;
   broadcast(room,{type:"state",state:state(room)});return;
  }
  if(m.type==="roll"){
   if(!room.game.started||room.game.awaitingMove)return;
   const idx=room.game.turn%room.players.length, p=room.players[idx];
   if(p.id!==ws.id)return;
   const value=1+Math.floor(Math.random()*6);
   room.game.dice=value;
   const can=p.pawns.some(x=>legal(x,value));
   if(!can){nextTurn(room,false);broadcast(room,{type:"state",state:state(room),event:{type:"roll",value}});return}
   if(value===6)room.game.sixes++;else room.game.sixes=0;
   if(room.game.sixes>=3){nextTurn(room,false);broadcast(room,{type:"state",state:state(room),event:{type:"roll",value}});return}
   room.game.awaitingMove=true;
   broadcast(room,{type:"state",state:state(room),event:{type:"roll",value}});return;
  }
  if(m.type==="move"){
   if(!room.game.started||!room.game.awaitingMove)return;
   const p=room.players[room.game.turn%room.players.length];if(p.id!==ws.id)return;
   const i=Number(m.pawn), pawn=p.pawns[i];if(!pawn||!legal(pawn,room.game.dice,p.color))return;
   const dice=room.game.dice, from=pawn.pos;
   const to=from<0?0:from+dice;
   const path=[];
   if(from<0){path.push(0)}else for(let q=from+1;q<=to;q++)path.push(q);
   pawn.pos=to;
   capture(room,p,to);
   const win=allHome(p);room.game.winner=win?p.id:null;
   const extra=dice===6&&!win;
   room.game.awaitingMove=false;
   if(win){room.game.dice=null}
   else if(extra){room.game.dice=null}
   else nextTurn(room,false);
   broadcast(room,{type:"state",state:state(room),event:{type:"move",playerId:p.id,pawn:i,from,to,path}});
  }
 });
 ws.on("close",()=>{
  const room=rooms.get(ws.room);if(!room)return;
  room.players=room.players.filter(p=>p.ws!==ws);
  if(!room.players.length)rooms.delete(room.id);
  else{room.game.turn=Math.min(room.game.turn,room.players.length-1);broadcast(room,{type:"state",state:state(room)})}
 });
});
const PORT=process.env.PORT||3000;
server.listen(PORT,"0.0.0.0",()=>console.log("Ludo Royale running on "+PORT));
