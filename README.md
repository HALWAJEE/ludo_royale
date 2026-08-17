# Ludo Royale

A multiplayer browser Ludo game designed for deployment as a Render Node Web Service.

## Render
Build command: `npm install`
Start command: `npm start`

The service must be a Web Service, not a static site, because WebSockets are used for multiplayer.

## Rules implemented
- 2–4 players
- Server-authoritative random dice (1–6)
- A pawn leaves base only on a 6
- A player may choose any legal pawn after a roll
- Exact count required to reach the finish
- Landing on an unprotected opponent pawn captures it
- 8 standard safe/star squares
- Rolling a 6 grants another roll after the move
- Captures and reaching home also grant another roll
- Four pawns home wins the game


## v4.0.1
Fixed selectable home pawns: when a player rolls 6, eligible pawns in the home area now receive the glowing selection ring and can be clicked to enter the board.
