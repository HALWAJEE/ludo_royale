# Ludo Royale Online

This version is deployment-ready for a public Node.js Web Service. It uses Express + WebSocket and listens on `process.env.PORT` / `0.0.0.0`, so a host can expose it to the internet.

## Local
npm install
npm start

## Deploy
Push this folder to GitHub, then create a Node.js Web Service on Render or Railway. Build command: `npm install`. Start command: `npm start`. The service receives a public HTTPS URL; WebSocket clients automatically use `wss://` on HTTPS.

Render supports inbound WebSockets on web services and public `onrender.com` URLs. Free web services may spin down after 15 minutes of inactivity.

## Current game scope
Online rooms, room codes, 2–4 player lobby, real-time server-side dice/turn synchronization, and responsive board are included. Full token-by-token official Ludo rules are still a later game-logic step.
