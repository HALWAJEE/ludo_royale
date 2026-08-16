const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname));

const SAFE_TILES = [0, 8, 13, 21, 26, 34, 39, 47];
const PLAYER_CONFIG = [
  { id: 0, name: 'Red', startTile: 0 },
  { id: 1, name: 'Green', startTile: 13 },
  { id: 2, name: 'Yellow', startTile: 26 },
  { id: 3, name: 'Blue', startTile: 39 }
];

const rooms = {};

function initTokens() {
  const tokens = [];
  for (let p = 0; p < 4; p++) {
    for (let t = 0; t < 4; t++) {
      tokens.push({ playerId: p, id: t, step: -1, baseOffset: t });
    }
  }
  return tokens;
}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ playerName }) => {
    let roomCode = generateRoomCode();
    while (rooms[roomCode]) roomCode = generateRoomCode();

    rooms[roomCode] = {
      code: roomCode,
      hostId: socket.id,
      gameStarted: false,
      players: [{ socketId: socket.id, name: playerName || 'Player 1', seat: 0 }],
      currentTurnSeat: 0,
      diceValue: null,
      hasRolled: false,
      tokens: initTokens(),
      statusMessage: 'Waiting for players to join...',
      winner: null
    };

    socket.join(roomCode);
    socket.emit('roomJoined', { room: rooms[roomCode], playerSeat: 0 });
  });

  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms[code];

    if (!room) return socket.emit('errorMsg', 'Room not found.');
    if (room.gameStarted) return socket.emit('errorMsg', 'Game already in progress.');
    if (room.players.length >= 4) return socket.emit('errorMsg', 'Room is full (max 4 players).');

    const assignedSeat = room.players.length;
    room.players.push({
      socketId: socket.id,
      name: playerName || `Player ${assignedSeat + 1}`,
      seat: assignedSeat
    });

    socket.join(code);
    socket.emit('roomJoined', { room, playerSeat: assignedSeat });
    io.to(code).emit('roomUpdate', room);
  });

  socket.on('startGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return socket.emit('errorMsg', 'Need at least 2 players to start.');

    room.gameStarted = true;
    room.currentTurnSeat = 0;
    room.statusMessage = `${room.players[0].name}'s turn. Roll the dice!`;
    io.to(roomCode).emit('gameStateUpdate', room);
  });

  socket.on('rollDice', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || !room.gameStarted || room.hasRolled || room.winner !== null) return;

    const currentActivePlayer = room.players[room.currentTurnSeat];
    if (currentActivePlayer.socketId !== socket.id) return;

    const roll = Math.floor(Math.random() * 6) + 1;
    room.diceValue = roll;
    room.hasRolled = true;

    const validMoves = room.tokens.filter((t) => {
      if (t.playerId !== currentActivePlayer.seat) return false;
      if (t.step === 56) return false;
      if (t.step === -1) return roll === 6;
      return t.step + roll <= 56;
    });

    io.to(roomCode).emit('diceRolled', { diceValue: roll, currentTurnSeat: room.currentTurnSeat });

    if (validMoves.length === 0) {
      room.statusMessage = `${currentActivePlayer.name} rolled a ${roll}. No moves available!`;
      setTimeout(() => advanceTurn(room), 1400);
    } else {
      room.statusMessage = `${currentActivePlayer.name} rolled a ${roll}. Select a pawn to move.`;
      setTimeout(() => {
        io.to(roomCode).emit('gameStateUpdate', room);
      }, 700);
    }
  });

  socket.on('moveToken', ({ roomCode, tokenId }) => {
    const room = rooms[roomCode];
    if (!room || !room.gameStarted || !room.hasRolled || room.winner !== null) return;

    const currentActivePlayer = room.players[room.currentTurnSeat];
    if (currentActivePlayer.socketId !== socket.id) return;

    const token = room.tokens.find(
      (t) => t.playerId === currentActivePlayer.seat && t.id === tokenId
    );
    if (!token) return;

    const fromStep = token.step;
    let toStep = token.step;

    if (token.step === -1 && room.diceValue === 6) {
      toStep = 0;
    } else if (token.step >= 0 && token.step + room.diceValue <= 56) {
      toStep += room.diceValue;
    } else {
      return;
    }

    token.step = toStep;

    let captured = null;
    if (token.step >= 0 && token.step <= 50) {
      const pConfig = PLAYER_CONFIG[token.playerId];
      const targetGlobal = (pConfig.startTile + token.step) % 52;

      if (!SAFE_TILES.includes(targetGlobal)) {
        room.tokens.forEach((other) => {
          if (other.playerId !== token.playerId && other.step >= 0 && other.step <= 50) {
            const otherConfig = PLAYER_CONFIG[other.playerId];
            const otherGlobal = (otherConfig.startTile + other.step) % 52;
            if (targetGlobal === otherGlobal) {
              other.step = -1;
              captured = { playerId: other.playerId, id: other.id };
              room.statusMessage = `${currentActivePlayer.name} captured an opponent's pawn!`;
            }
          }
        });
      }
    }

    io.to(roomCode).emit('tokenMoved', {
      playerId: currentActivePlayer.seat,
      tokenId: token.id,
      fromStep,
      toStep,
      capturedToken: captured
    });

    const finished = room.tokens.filter(
      (t) => t.playerId === currentActivePlayer.seat && t.step === 56
    ).length;

    if (finished === 4) {
      room.winner = currentActivePlayer.name;
      room.statusMessage = `🎉 ${currentActivePlayer.name} HAS WON THE GAME! 🎉`;
      setTimeout(() => io.to(roomCode).emit('gameStateUpdate', room), 600);
      return;
    }

    if (room.diceValue === 6 || captured !== null) {
      room.hasRolled = false;
      room.statusMessage = `${currentActivePlayer.name} gets a bonus roll!`;
      setTimeout(() => io.to(roomCode).emit('gameStateUpdate', room), 600);
    } else {
      setTimeout(() => advanceTurn(room), 600);
    }
  });

  function advanceTurn(room) {
    room.currentTurnSeat = (room.currentTurnSeat + 1) % room.players.length;
    room.hasRolled = false;
    room.diceValue = null;
    const nextPlayer = room.players[room.currentTurnSeat];
    room.statusMessage = `${nextPlayer.name}'s turn. Roll the dice!`;
    io.to(room.code).emit('gameStateUpdate', room);
  }

  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      const idx = room.players.findIndex((p) => p.socketId === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          delete rooms[code];
        } else {
          io.to(code).emit('roomUpdate', room);
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Ludo Royale Server running on port ${PORT}`);
});
