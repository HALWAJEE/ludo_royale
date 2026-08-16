const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Your HTML/CSS/JS files are in the ROOT of the GitHub repository.
app.use(express.static(__dirname));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const rooms = new Map();
const colors = ["red", "green", "yellow", "blue"];

function send(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

function makeRoomCode() {
  let code;

  do {
    code = Math.random()
      .toString(36)
      .slice(2, 7)
      .toUpperCase();
  } while (rooms.has(code));

  return code;
}

function newGame() {
  return {
    turn: 0,
    dice: null,
    rolled: false,
    winner: null
  };
}

function getState(room) {
  return {
    roomId: room.id,
    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      color: player.color
    })),
    started: room.started,
    game: room.game
  };
}

function broadcast(room, message) {
  room.players.forEach(player => {
    send(player.ws, message);
  });
}

wss.on("connection", ws => {
  ws.id = Math.random().toString(36).slice(2);

  ws.on("message", raw => {
    let message;

    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    // CREATE OR JOIN ROOM
    if (message.type === "create" || message.type === "join") {
      const roomId =
        message.type === "create"
          ? makeRoomCode()
          : String(message.roomId || "").toUpperCase();

      let room = rooms.get(roomId);

      if (message.type === "join" && !room) {
        return send(ws, {
          type: "error",
          message: "Room not found."
        });
      }

      if (!room) {
        room = {
          id: roomId,
          players: [],
          started: false,
          game: null
        };

        rooms.set(roomId, room);
      }

      if (room.players.length >= 4) {
        return send(ws, {
          type: "error",
          message: "Room is full."
        });
      }

      const player = {
        ws,
        id: ws.id,
        name: String(message.name || "Player").slice(0, 16),
        color: colors[room.players.length]
      };

      room.players.push(player);
      ws.room = roomId;

      send(ws, {
        type: "joined",
        selfId: ws.id,
        state: getState(room)
      });

      broadcast(room, {
        type: "state",
        state: getState(room)
      });

      return;
    }

    const room = rooms.get(ws.room);

    if (!room) return;

    // START GAME
    if (message.type === "start") {
      if (room.players.length < 2) {
        return send(ws, {
          type: "error",
          message: "At least 2 players are needed."
        });
      }

      room.started = true;
      room.game = newGame();

      broadcast(room, {
        type: "state",
        state: getState(room)
      });

      return;
    }

    // ROLL DICE
    if (message.type === "roll") {
      if (!room.started || !room.game) return;

      const currentPlayer =
        room.players[room.game.turn % room.players.length];

      if (currentPlayer.id !== ws.id) return;

      room.game.dice =
        Math.floor(Math.random() * 6) + 1;

      if (room.game.dice !== 6) {
        room.game.turn =
          (room.game.turn + 1) %
          room.players.length;
      }

      broadcast(room, {
        type: "state",
        state: getState(room)
      });
    }
  });

  // PLAYER DISCONNECTED
  ws.on("close", () => {
    const room = rooms.get(ws.room);

    if (!room) return;

    room.players =
      room.players.filter(player => player.ws !== ws);

    if (room.players.length === 0) {
      rooms.delete(room.id);
    } else {
      room.game = room.started
        ? room.game || newGame()
        : null;

      broadcast(room, {
        type: "state",
        state: getState(room)
      });
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Ludo Royale server running on port ${PORT}`
  );
});
