const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;
const COLORS = ["red","green","yellow","blue"];
const START = { red:0, green:13, yellow:26, blue:39 };
const SAFE = new Set([0,8,13,21,26,34,39,47]);
const rooms = new Map();

app.use(express.static(__dirname));
app.get("*", (_req,res) => res.sendFile(path.join(__dirname,"index.html")));

function send(ws,msg){ if(ws.readyState===1) ws.send(JSON.stringify(msg)); }
function broadcast(room,msg){ for(const p of room.players) send(p.ws,msg); }
function snapshot(room){
  return {
    roomId: room.id,
    started: room.started,
    players: room.players.map(p => ({id:p.id,name:p.name,color:p.color,tokens:[...p.tokens]})),
    game: room.game ? {
      turn: room.game.turn,
      dice: room.game.dice,
      winner: room.game.winner || null
    } : null
  };
}
function roomCode(){
  let c;
  do c = crypto.randomBytes(3).toString("hex").slice(0,5).toUpperCase();
  while(rooms.has(c));
  return c;
}
function trackIndex(color, progress){ return (START[color] + progress) % 52; }
function canMove(token, dice){
  if(token >= 56) return false;
  if(token < 0) return dice === 6;
  return token + dice <= 56;
}
function hasLegal(player,dice){ return player.tokens.some(t => canMove(t,dice)); }
function boardIndex(player,progress){ return progress >= 0 && progress < 51 ? trackIndex(player.color,progress) : null; }
function capture(room,mover,tokenIndex){
  const idx = boardIndex(mover,mover.tokens[tokenIndex]);
  if(idx === null || SAFE.has(idx)) return false;
  let captured = false;
  for(const opponent of room.players){
    if(opponent.id === mover.id) continue;
    opponent.tokens = opponent.tokens.map(t => {
      if(boardIndex(opponent,t) === idx){ captured = true; return -1; }
      return t;
    });
  }
  return captured;
}
function nextTurn(room){
  room.game.turn = (room.game.turn + 1) % room.players.length;
  room.game.sixes = 0;
}

wss.on("connection", ws => {
  ws.id = crypto.randomUUID();

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if(msg.type === "create" || msg.type === "join"){
      const requested = String(msg.roomId || "").toUpperCase();
      let room = msg.type === "create" ? null : rooms.get(requested);
      if(msg.type === "join" && !room) return send(ws,{type:"error",message:"Room not found. Check the code."});
      if(!room){ room = { id:roomCode(), players:[], started:false, game:null }; rooms.set(room.id,room); }
      if(room.started) return send(ws,{type:"error",message:"That game has already started."});
      if(room.players.length >= 4) return send(ws,{type:"error",message:"Room is full."});

      const player = {
        id:ws.id,
        ws,
        name:String(msg.name || "Player").trim().slice(0,16) || "Player",
        color:COLORS[room.players.length],
        tokens:[-1,-1,-1,-1]
      };
      room.players.push(player);
      ws.roomId = room.id;
      send(ws,{type:"joined",selfId:ws.id,state:snapshot(room)});
      broadcast(room,{type:"state",state:snapshot(room)});
      return;
    }

    const room = rooms.get(ws.roomId);
    if(!room) return;
    const me = room.players.find(p => p.id === ws.id);
    if(!me) return;

    if(msg.type === "start"){
      if(room.players.length < 2) return send(ws,{type:"error",message:"At least 2 players are needed."});
      if(room.started) return;
      room.started = true;
      room.game = { turn:0, dice:null, winner:null, sixes:0 };
      broadcast(room,{type:"state",state:snapshot(room)});
      return;
    }

    if(!room.started || !room.game || room.game.winner) return;
    const current = room.players[room.game.turn];
    if(!current || current.id !== ws.id) return;

    if(msg.type === "roll"){
      if(room.game.dice !== null) return;
      const dice = Math.floor(Math.random()*6)+1;
      room.game.dice = dice;
      if(dice === 6) room.game.sixes += 1; else room.game.sixes = 0;

      // Three consecutive sixes cancel the entire sequence and pass the turn.
      if(room.game.sixes >= 3){
        room.game.dice = null;
        room.game.sixes = 0;
        send(ws,{type:"rollResult",dice,legal:[]});
        nextTurn(room);
        broadcast(room,{type:"state",state:snapshot(room)});
        return;
      }

      const legal = current.tokens.map((t,i)=>canMove(t,dice)?i:-1).filter(i=>i>=0);
      send(ws,{type:"rollResult",dice,legal});
      if(!legal.length){
        // A six still grants the bonus roll; otherwise the turn passes.
        room.game.dice = null;
        if(dice !== 6) nextTurn(room);
        broadcast(room,{type:"state",state:snapshot(room)});
      }
      return;
    }

    if(msg.type === "move"){
      if(room.game.dice === null) return;
      const tokenIndex = Number(msg.token);
      if(!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 3) return;
      const dice = room.game.dice;
      const token = current.tokens[tokenIndex];
      if(!canMove(token,dice)) return;

      current.tokens[tokenIndex] = token < 0 ? 0 : token + dice;
      const captured = capture(room,current,tokenIndex);
      const finished = current.tokens.every(t => t === 56);
      room.game.dice = null;

      if(finished){
        room.game.winner = current.id;
      } else if(dice === 6 || captured){
        // Same player's turn.
      } else {
        nextTurn(room);
      }
      broadcast(room,{type:"state",state:snapshot(room)});
    }
  });

  ws.on("close", () => {
    const room = rooms.get(ws.roomId);
    if(!room) return;
    const leavingIndex = room.players.findIndex(p=>p.id===ws.id);
    if(leavingIndex < 0) return;
    room.players.splice(leavingIndex,1);
    if(!room.players.length){ rooms.delete(room.id); return; }

    if(room.started){
      // Keep the game playable if someone disconnects.
      if(room.game.turn >= room.players.length) room.game.turn = 0;
      room.game.sixes = 0;
      room.game.dice = null;
    }
    broadcast(room,{type:"state",state:snapshot(room)});
  });
});

server.listen(PORT,"0.0.0.0",()=>console.log(`Ludo Royale listening on ${PORT}`));
