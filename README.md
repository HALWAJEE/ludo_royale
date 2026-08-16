# Ludo Royale v3

A responsive 2–4 player browser Ludo game using Express and WebSockets.

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Runtime: Node

## Rules implemented
- 4 pawns per player
- 6 required to leave the yard
- 6 gives another roll
- three consecutive sixes forfeit the sequence
- clockwise movement
- captures on non-safe shared-track squares
- eight safe squares
- coloured home lane
- exact roll to finish
- first player with all four pawns home wins

## Multiplayer
Create a room, share the five-character code, and have friends join from any network. The server synchronizes turns, dice rolls, pawn positions and captures over WebSocket.
