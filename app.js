const canvas = document.getElementById('ludoCanvas');
const ctx = canvas.getContext('2d');
const rollBtn = document.getElementById('roll-btn');
const diceDisplay = document.getElementById('dice-display');
const turnText = document.getElementById('current-player-name');
const messageBox = document.getElementById('message');
const resetBtn = document.getElementById('reset-btn');

const BOARD_SIZE = 15;
const TILE_SIZE = canvas.width / BOARD_SIZE;

const PLAYERS = [
  { id: 0, name: 'Red', color: '#ff3d00', homeX: 1, homeY: 1, startTile: 0, endTile: 50 },
  { id: 1, name: 'Green', color: '#00e676', homeX: 9, homeY: 1, startTile: 13, endTile: 11 },
  { id: 2, name: 'Yellow', color: '#ffd600', homeX: 9, homeY: 9, startTile: 26, endTile: 24 },
  { id: 3, name: 'Blue', color: '#2979ff', homeX: 1, homeY: 9, startTile: 39, endTile: 37 }
];

const MAIN_PATH = [
  { x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 },
  { x: 6, y: 5 }, { x: 6, y: 4 }, { x: 6, y: 3 }, { x: 6, y: 2 }, { x: 6, y: 1 }, { x: 6, y: 0 },
  { x: 7, y: 0 }, { x: 8, y: 0 },
  { x: 8, y: 1 }, { x: 8, y: 2 }, { x: 8, y: 3 }, { x: 8, y: 4 }, { x: 8, y: 5 },
  { x: 9, y: 6 }, { x: 10, y: 6 }, { x: 11, y: 6 }, { x: 12, y: 6 }, { x: 13, y: 6 }, { x: 14, y: 6 },
  { x: 14, y: 7 }, { x: 14, y: 8 },
  { x: 13, y: 8 }, { x: 12, y: 8 }, { x: 11, y: 8 }, { x: 10, y: 8 }, { x: 9, y: 8 },
  { x: 8, y: 9 }, { x: 8, y: 10 }, { x: 8, y: 11 }, { x: 8, y: 12 }, { x: 8, y: 13 }, { x: 8, y: 14 },
  { x: 7, y: 14 }, { x: 6, y: 14 },
  { x: 6, y: 13 }, { x: 6, y: 12 }, { x: 6, y: 11 }, { x: 6, y: 10 }, { x: 6, y: 9 },
  { x: 5, y: 8 }, { x: 4, y: 8 }, { x: 3, y: 8 }, { x: 2, y: 8 }, { x: 1, y: 8 }, { x: 0, y: 8 },
  { x: 0, y: 7 }, { x: 0, y: 6 }
];

const SAFE_TILES = [0, 8, 13, 21, 26, 34, 39, 47];

let currentTurn = 0;
let diceValue = null;
let hasRolled = false;
let tokens = [];

function initTokens() {
  tokens = [];
  PLAYERS.forEach(player => {
    for (let i = 0; i < 4; i++) {
      tokens.push({
        playerId: player.id,
        id: i,
        step: -1, // -1 = base, 0..50 = main path, 51..55 = victory road, 56 = finished
        baseOffset: i
      });
    }
  });
}

function drawBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background Grid
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  for (let i = 0; i < BOARD_SIZE; i++) {
    for (let j = 0; j < BOARD_SIZE; j++) {
      ctx.strokeRect(i * TILE_SIZE, j * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  // Home Bases
  drawBase(0, 0, '#ff3d00');
  drawBase(9, 0, '#00e676');
  drawBase(9, 9, '#ffd600');
  drawBase(0, 9, '#2979ff');

  // Victory Center
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(6 * TILE_SIZE, 6 * TILE_SIZE, 3 * TILE_SIZE, 3 * TILE_SIZE);

  // Home Stretch Paths
  for (let i = 1; i <= 5; i++) {
    drawTile(i, 7, '#ff3d00');
    drawTile(7, i, '#00e676');
    drawTile(14 - i, 7, '#ffd600');
    drawTile(7, 14 - i, '#2979ff');
  }

  // Safe Tile Marks
  SAFE_TILES.forEach(idx => {
    const tile = MAIN_PATH[idx];
    ctx.fillStyle = '#b0bec5';
    ctx.beginPath();
    ctx.arc((tile.x + 0.5) * TILE_SIZE, (tile.y + 0.5) * TILE_SIZE, TILE_SIZE * 0.25, 0, Math.PI * 2);
    ctx.fill();
  });

  // Tokens
  tokens.forEach(token => {
    const pos = getTokenCanvasPos(token);
    drawToken(pos.x, pos.y, PLAYERS[token.playerId].color, token.step === 56);
  });
}

function drawBase(gx, gy, color) {
  ctx.fillStyle = color;
  ctx.fillRect(gx * TILE_SIZE, gy * TILE_SIZE, 6 * TILE_SIZE, 6 * TILE_SIZE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect((gx + 1) * TILE_SIZE, (gy + 1) * TILE_SIZE, 4 * TILE_SIZE, 4 * TILE_SIZE);
}

function drawTile(gx, gy, color) {
  ctx.fillStyle = color;
  ctx.fillRect(gx * TILE_SIZE, gy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  ctx.strokeRect(gx * TILE_SIZE, gy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
}

function getTokenCanvasPos(token) {
  const p = PLAYERS[token.playerId];

  if (token.step === -1) {
    const offsets = [
      { dx: 1.8, dy: 1.8 },
      { dx: 3.2, dy: 1.8 },
      { dx: 1.8, dy: 3.2 },
      { dx: 3.2, dy: 3.2 }
    ];
    const off = offsets[token.baseOffset];
    return { x: (p.homeX + off.dx) * TILE_SIZE, y: (p.homeY + off.dy) * TILE_SIZE };
  }

  if (token.step >= 0 && token.step <= 50) {
    const globalIdx = (p.startTile + token.step) % 52;
    const tile = MAIN_PATH[globalIdx];
    return { x: (tile.x + 0.5) * TILE_SIZE, y: (tile.y + 0.5) * TILE_SIZE };
  }

  if (token.step >= 51 && token.step <= 55) {
    const homeIdx = token.step - 50;
    let gx = 7, gy = 7;
    if (token.playerId === 0) { gx = homeIdx; gy = 7; }
    if (token.playerId === 1) { gx = 7; gy = homeIdx; }
    if (token.playerId === 2) { gx = 14 - homeIdx; gy = 7; }
    if (token.playerId === 3) { gx = 7; gy = 14 - homeIdx; }
    return { x: (gx + 0.5) * TILE_SIZE, y: (gy + 0.5) * TILE_SIZE };
  }

  return { x: 7.5 * TILE_SIZE, y: 7.5 * TILE_SIZE };
}

function drawToken(x, y, color, isDone) {
  ctx.beginPath();
  ctx.arc(x, y, TILE_SIZE * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = isDone ? '#777' : color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

rollBtn.addEventListener('click', () => {
  if (hasRolled) return;
  diceValue = Math.floor(Math.random() * 6) + 1;
  diceDisplay.textContent = diceValue;
  hasRolled = true;
  rollBtn.disabled = true;

  const validMoves = getMovableTokens(currentTurn, diceValue);
  if (validMoves.length === 0) {
    messageBox.textContent = `No moves available for ${PLAYERS[currentTurn].name}. Passing turn...`;
    setTimeout(nextTurn, 1000);
  } else if (validMoves.length === 1) {
    moveToken(validMoves[0]);
  } else {
    messageBox.textContent = `Select a token to move ${diceValue} steps.`;
  }
});

function getMovableTokens(playerId, roll) {
  return tokens.filter(t => {
    if (t.playerId !== playerId) return false;
    if (t.step === 56) return false;
    if (t.step === -1) return roll === 6;
    return t.step + roll <= 56;
  });
}

canvas.addEventListener('click', (e) => {
  if (!hasRolled) return;
  const rect = canvas.getBoundingClientRect();
  const clickX = (e.clientX - rect.left) * (canvas.width / rect.width);
  const clickY = (e.clientY - rect.top) * (canvas.height / rect.height);

  const movable = getMovableTokens(currentTurn, diceValue);
  for (const token of movable) {
    const pos = getTokenCanvasPos(token);
    const dist = Math.hypot(clickX - pos.x, clickY - pos.y);
    if (dist <= TILE_SIZE * 0.45) {
      moveToken(token);
      break;
    }
  }
});

function moveToken(token) {
  if (token.step === -1) {
    token.step = 0;
    messageBox.textContent = `${PLAYERS[currentTurn].name} unlocked a token!`;
  } else {
    token.step += diceValue;
    if (token.step === 56) {
      messageBox.textContent = `${PLAYERS[currentTurn].name} scored a token home!`;
    }
  }

  // Handle capture on main path
  if (token.step >= 0 && token.step <= 50) {
    const p = PLAYERS[token.playerId];
    const currentGlobalTile = (p.startTile + token.step) % 52;

    if (!SAFE_TILES.includes(currentGlobalTile)) {
      tokens.forEach(other => {
        if (other.playerId !== token.playerId && other.step >= 0 && other.step <= 50) {
          const otherP = PLAYERS[other.playerId];
          const otherGlobalTile = (otherP.startTile + other.step) % 52;
          if (currentGlobalTile === otherGlobalTile) {
            other.step = -1;
            messageBox.textContent = `${PLAYERS[currentTurn].name} captured ${PLAYERS[other.playerId].name}'s token!`;
          }
        }
      });
    }
  }

  drawBoard();

  if (checkWinner(currentTurn)) {
    messageBox.textContent = `🎉 ${PLAYERS[currentTurn].name} WINS THE GAME! 🎉`;
    rollBtn.disabled = true;
    return;
  }

  if (diceValue === 6) {
    messageBox.textContent = `${PLAYERS[currentTurn].name} rolled a 6! Roll again.`;
    hasRolled = false;
    rollBtn.disabled = false;
  } else {
    setTimeout(nextTurn, 800);
  }
}

function checkWinner(playerId) {
  return tokens.filter(t => t.playerId === playerId && t.step === 56).length === 4;
}

function nextTurn() {
  currentTurn = (currentTurn + 1) % 4;
  turnText.textContent = PLAYERS[currentTurn].name;
  turnText.style.color = PLAYERS[currentTurn].color;
  hasRolled = false;
  rollBtn.disabled = false;
  messageBox.textContent = `${PLAYERS[currentTurn].name}'s turn. Click "Roll Dice".`;
}

resetBtn.addEventListener('click', () => {
  initTokens();
  currentTurn = 0;
  diceValue = 1;
  hasRolled = false;
  rollBtn.disabled = false;
  diceDisplay.textContent = '1';
  turnText.textContent = PLAYERS[0].name;
  turnText.style.color = PLAYERS[0].color;
  messageBox.textContent = 'Game reset. Click "Roll Dice" to start!';
  drawBoard();
});

// Initial boot
initTokens();
turnText.style.color = PLAYERS[0].color;
drawBoard();

