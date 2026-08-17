# Ludo Royale — Fixed Pawn Edition

A multiplayer Ludo web game using Express + WebSocket.

## Render
Build command:
`npm install`

Start command:
`npm start`

The server listens on `process.env.PORT` and `0.0.0.0`.

## Important pawn fix
Selectable pawns use a **ring underneath the pawn**. The ring is absolutely positioned below the pawn and its animation only scales the ring. The pawn itself does not translate upward, so it never appears to fly.

The pawn is built from a head, body, foot and highlight instead of a tiny circular button.
