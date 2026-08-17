const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const rooms = new Map();
const COLORS = ['red', 'green', 'yellow', 'blue'];
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

function send(ws, data) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(room, data) {
  for (const p of room.players) send(p.ws, data);
}
function roomCode() {
  let id;
  do id = crypto.randomBytes(3).toString('hex').slice(0, 5).toUpperCase();
  while (rooms.has(id));
  return id;
}
function newGame() {
  return {
    started: false,
    turn: 0,
    dice: null,
    awaitingMove: false,
    winner: null,
    lastAction: null,
    pawns: []
  };
}
function freshPawns() { return [0, 0, 0, 0]; }
function state(room) {
  return {
    roomId: room.id,
    hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color })),
    game: room.game ? {
      started: room.game.started,
      turn: room.game.turn,
      dice: room.game.dice,
      awaitingMove: room.game.awaitingMove,
      winner: room.game.winner,
      lastAction: room.game.lastAction,
      pawns: room.game.pawns.map(a => [...a])
    } : null
  };
}
function broadcastState(room) { broadcast(room, { type: 'state', state: state(room) }); }
function currentPlayer(room) {
  if (!room.game || !room.players.length) return null;
  return room.players[room.game.turn % room.players.length];
}
function startGame(room) {
  room.game = newGame();
  room.game.started = true;
  room.game.pawns = room.players.map(() => freshPawns());
  room.game.turn = 0;
  room.game.lastAction = 'Game started. Red goes first.';
}
function globalIndex(playerIndex, step) {
  const starts = [0, 13, 26, 39];
  return (starts[playerIndex] + step - 1) % 52;
}
function validMoves(room, playerIndex, dice) {
  const pawns = room.game.pawns[playerIndex] || [];
  const out = [];
  pawns.forEach((pos, i) => {
    if (pos === 58) return;
    if (pos === 0) {
      if (dice === 6) out.push(i);
    } else if (pos + dice <= 58) {
      out.push(i);
    }
  });
  return out;
}
function capture(room, movingPlayer, newPos) {
  if (newPos < 1 || newPos > 52) return [];
  const landed = globalIndex(movingPlayer, newPos);
  if (SAFE.has(landed)) return [];
  const captured = [];
  for (let pi = 0; pi < room.game.pawns.length; pi++) {
    if (pi === movingPlayer) continue;
    for (let j = 0; j < room.game.pawns[pi].length; j++) {
      const pos = room.game.pawns[pi][j];
      if (pos >= 1 && pos <= 52 && globalIndex(pi, pos) === landed) {
        room.game.pawns[pi][j] = 0;
        captured.push({ player: pi, pawn: j });
      }
    }
  }
  return captured;
}
function nextTurn(room) {
  room.game.turn = (room.game.turn + 1) % room.players.length;
  room.game.dice = null;
  room.game.awaitingMove = false;
}
function playerIndex(room, id) { return room.players.findIndex(p => p.id === id); }

wss.on('connection', ws => {
  ws.id = crypto.randomUUID();

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', message: 'Invalid message.' }); }

    if (m.type === 'create') {
      const id = roomCode();
      const room = { id, hostId: ws.id, players: [], game: null };
      rooms.set(id, room);
      room.players.push({ ws, id: ws.id, name: String(m.name || 'Player').trim().slice(0, 16) || 'Player', color: COLORS[0] });
      ws.room = id;
      send(ws, { type: 'joined', selfId: ws.id, state: state(room) });
      return;
    }

    if (m.type === 'join') {
      const id = String(m.roomId || '').trim().toUpperCase();
      const room = rooms.get(id);
      if (!room) return send(ws, { type: 'error', message: 'Room not found. Check the room code.' });
      if (room.game?.started) return send(ws, { type: 'error', message: 'That game has already started.' });
      if (room.players.length >= 4) return send(ws, { type: 'error', message: 'Room is full.' });
      room.players.push({ ws, id: ws.id, name: String(m.name || 'Player').trim().slice(0, 16) || 'Player', color: COLORS[room.players.length] });
      ws.room = id;
      send(ws, { type: 'joined', selfId: ws.id, state: state(room) });
      broadcastState(room);
      return;
    }

    const room = rooms.get(ws.room);
    if (!room) return send(ws, { type: 'error', message: 'Join or create a room first.' });

    if (m.type === 'start') {
      if (ws.id !== room.hostId) return send(ws, { type: 'error', message: 'Only the room creator can start the game.' });
      if (room.players.length < 2) return send(ws, { type: 'error', message: 'You need at least 2 players.' });
      startGame(room);
      broadcastState(room);
      return;
    }

    if (m.type === 'roll') {
      if (!room.game?.started) return send(ws, { type: 'error', message: 'The game has not started.' });
      const idx = playerIndex(room, ws.id);
      if (idx !== room.game.turn) return send(ws, { type: 'error', message: 'It is not your turn.' });
      if (room.game.awaitingMove) return send(ws, { type: 'error', message: 'Choose a highlighted pawn first.' });

      // IMPORTANT: every roll is generated independently on the server.
      const dice = crypto.randomInt(1, 7);
      room.game.dice = dice;
      const moves = validMoves(room, idx, dice);
      room.game.awaitingMove = moves.length > 0;
      room.game.lastAction = `${room.players[idx].name} rolled ${dice}.`;
      broadcastState(room);

      if (!moves.length) {
        setTimeout(() => {
          if (!room.game || !room.game.started || room.game.dice !== dice || room.game.turn !== idx || room.game.awaitingMove) return;
          if (dice !== 6) nextTurn(room);
          else { room.game.dice = null; room.game.lastAction = `${room.players[idx].name} rolled 6 but has no legal move.`; }
          broadcastState(room);
        }, 900);
      }
      return;
    }

    if (m.type === 'move') {
      if (!room.game?.started) return;
      const idx = playerIndex(room, ws.id);
      if (idx !== room.game.turn || !room.game.awaitingMove) return send(ws, { type: 'error', message: 'That pawn cannot be moved now.' });
      const pawn = Number(m.pawn);
      const dice = room.game.dice;
      if (!Number.isInteger(pawn) || pawn < 0 || pawn > 3) return;
      if (!validMoves(room, idx, dice).includes(pawn)) return send(ws, { type: 'error', message: 'That pawn cannot move with this dice roll.' });

      const oldPos = room.game.pawns[idx][pawn];
      const newPos = oldPos === 0 ? 1 : oldPos + dice;
      room.game.pawns[idx][pawn] = newPos;
      const captured = capture(room, idx, newPos);
      const finished = newPos === 58;
      const homeCount = room.game.pawns[idx].filter(p => p === 58).length;
      room.game.awaitingMove = false;
      room.game.lastAction = `${room.players[idx].name} moved pawn ${pawn + 1}${captured.length ? ' and captured a pawn' : ''}.`;

      if (homeCount === 4) {
        room.game.winner = idx;
        room.game.lastAction = `${room.players[idx].name} wins!`;
      } else if (dice !== 6 && captured.length === 0 && !finished) {
        nextTurn(room);
      } else {
        room.game.dice = null;
        room.game.awaitingMove = false;
      }
      broadcast(room, { type: 'move', player: idx, pawn, from: oldPos, to: newPos, captured, state: state(room) });
      return;
    }

    if (m.type === 'restart') {
      if (ws.id !== room.hostId) return send(ws, { type: 'error', message: 'Only the host can restart.' });
      if (room.players.length < 2) return send(ws, { type: 'error', message: 'You need at least 2 players.' });
      startGame(room);
      broadcastState(room);
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.room);
    if (!room) return;
    room.players = room.players.filter(p => p.ws !== ws);
    if (!room.players.length) return rooms.delete(room.id);
    if (room.game?.started) {
      // Keep the room usable if someone leaves, but reset to a clean turn order.
      if (room.players.length < 2) room.game.started = false;
      room.game.turn = Math.min(room.game.turn, room.players.length - 1);
    }
    if (room.hostId === ws.id) room.hostId = room.players[0].id;
    broadcastState(room);
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Ludo Royale listening on ${PORT}`));
