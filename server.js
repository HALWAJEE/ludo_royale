const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));
app.get("*", (req,res)=>res.sendFile(path.join(__dirname,"index.html")));

const rooms = new Map();
const COLORS = ["red","green","yellow","blue"];
const START = {red:0,green:13,yellow:26,blue:39};
const SAFE = new Set([0,8,13,21,26,34,39,47]);

function send(ws,obj){ if(ws.readyState===1) ws.send(JSON.stringify(obj)); }
function broadcast(room,obj){ room.players.forEach(p=>send(p.ws,obj)); }
function roomCode(){
  let x;
  do x=Math.random().toString(36).slice(2,7).toUpperCase();
  while(rooms.has(x));
  return x;
}
function newGame(){
  return {
    turn:0, turnColor:"red", dice:null, awaitingMove:false,
    pawns:{red:[-1,-1,-1,-1],green:[-1,-1,-1,-1],yellow:[-1,-1,-1,-1],blue:[-1,-1,-1,-1]},
    winner:null, sixes:0
  };
}
function publicState(room){
  return {
    roomId:room.id,
    started:room.started,
    players:room.players.map(p=>({id:p.id,name:p.name,color:p.color})),
    game:room.game
  };
}
function advance(room){
  room.game.dice=null;
  room.game.awaitingMove=false;
  room.game.sixes=0;
  room.game.turn=(room.game.turn+1)%room.players.length;
  room.game.turnColor=room.players[room.game.turn].color;
}
function legal(pos,dice){
  if(pos===57) return false;
  if(pos===-1) return dice===6;
  return pos+dice<=57;
}
function absoluteIndex(color,pos){
  return (START[color]+pos)%52;
}
function allHome(pawns){ return pawns.every(x=>x===57); }

wss.on("connection",ws=>{
  ws.id=Math.random().toString(36).slice(2);

  ws.on("message",raw=>{
    let m; try{m=JSON.parse(raw)}catch{return}

    if(m.type==="create"||m.type==="join"){
      const id=m.type==="create"?roomCode():String(m.roomId||"").trim().toUpperCase();
      if(!id) return send(ws,{type:"error",message:"Enter a room code."});
      let room=rooms.get(id);
      if(m.type==="join"&&!room) return send(ws,{type:"error",message:"Room not found."});
      if(!room){room={id,players:[],started:false,game:null};rooms.set(id,room)}
      if(room.started) return send(ws,{type:"error",message:"That game has already started."});
      if(room.players.length>=4) return send(ws,{type:"error",message:"Room is full."});

      const p={ws,id:ws.id,name:String(m.name||"Player").slice(0,16),color:COLORS[room.players.length]};
      room.players.push(p); ws.room=id;
      send(ws,{type:"joined",selfId:ws.id,state:publicState(room)});
      broadcast(room,{type:"state",state:publicState(room)});
      return;
    }

    const room=rooms.get(ws.room);
    if(!room) return;

    if(m.type==="start"){
      if(ws.id!==room.players[0]?.id) return;
      if(room.players.length<2) return send(ws,{type:"error",message:"At least 2 players are needed."});
      room.started=true; room.game=newGame(); room.game.turnColor=room.players[0].color;
      broadcast(room,{type:"state",state:publicState(room)}); return;
    }

    if(!room.started||!room.game||room.game.winner) return;

    const current=room.players[room.game.turn % room.players.length];
    if(current.id!==ws.id) return;

    if(m.type==="roll"){
      if(room.game.awaitingMove) return;
      const d=Math.floor(Math.random()*6)+1;
      room.game.dice=d;
      room.game.awaitingMove=true;
      if(d===6) room.game.sixes++;
      else room.game.sixes=0;

      const pawns=room.game.pawns[current.color];
      const any=pawns.some(pos=>legal(pos,d));

      if(!any){
        if(room.game.sixes>=3){
          room.game.sixes=0;
          advance(room);
        }else if(d!==6){
          advance(room);
        }else{
          room.game.dice=null;
          room.game.awaitingMove=false;
          // Keep turn after a six when no pawn can move.
        }
      }
      broadcast(room,{type:"state",state:publicState(room)});
      return;
    }

    if(m.type==="move"){
      if(!room.game.awaitingMove) return;
      const idx=Number(m.pawn);
      if(!Number.isInteger(idx)||idx<0||idx>3) return;
      const color=current.color;
      const old=room.game.pawns[color][idx];
      const d=room.game.dice;
      if(!legal(old,d)) return;

      let next=old===-1?0:old+d;
      room.game.pawns[color][idx]=next;

      // Capture opponents on non-safe outer-track squares.
      if(next<=51){
        const abs=absoluteIndex(color,next);
        room.players.forEach(op=>{
          if(op.color===color) return;
          room.game.pawns[op.color]=room.game.pawns[op.color].map(pos=>{
            if(pos>=0&&pos<=51&&absoluteIndex(op.color,pos)===abs&&!SAFE.has(abs)) return -1;
            return pos;
          });
        });
      }

      if(allHome(room.game.pawns[color])){
        room.game.winner=color;
        room.game.awaitingMove=false;
        room.game.dice=null;
      }else if(d===6){
        room.game.awaitingMove=false;
        room.game.dice=null;
      }else{
        advance(room);
      }
      broadcast(room,{type:"state",state:publicState(room)});
    }
  });

  ws.on("close",()=>{
    const room=rooms.get(ws.room); if(!room) return;
    room.players=room.players.filter(p=>p.ws!==ws);
    if(!room.players.length){rooms.delete(room.id);return}
    if(room.started && room.game){
      room.game.turn=Math.min(room.game.turn,room.players.length-1);
      room.game.turnColor=room.players[room.game.turn]?.color||"red";
    }
    broadcast(room,{type:"state",state:publicState(room)});
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,"0.0.0.0",()=>console.log(`Ludo Royale running on ${PORT}`));
