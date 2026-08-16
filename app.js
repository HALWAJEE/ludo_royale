window.addEventListener('DOMContentLoaded', () => {
  const socket = typeof io !== 'undefined' ? io() : null;

  if (!socket) {
    alert('Server connection error. Please refresh the page.');
    return;
  }

  let currentRoomCode = null;
  let myPlayerSeat = null;
  let latestGameState = null;

  const lobbySec = document.getElementById('lobby-section');
  const roomSec = document.getElementById('room-section');
  const gameSec = document.getElementById('game-section');

  const nameInput = document.getElementById('player-name-input');
  const roomCodeInput = document.getElementById('room-code-input');
  const createBtn = document.getElementById('create-room-btn');
  const joinBtn = document.getElementById('join-room-btn');
  const startBtn = document.getElementById('start-game-btn');
  const displayRoomCode = document.getElementById('display-room-code');
  const playerCount = document.getElementById('player-count');
  const playersList = document.getElementById('players-list');
  const waitingText = document.getElementById('waiting-text');

  const gameRoomId = document.getElementById('game-room-id');
  const turnBadge = document.getElementById('turn-badge');
  const dice3D = document.getElementById('3d-dice');
  const rollActionBtn = document.getElementById('roll-action-btn');
  const gameStatusMsg = document.getElementById('game-status-msg');

  const canvas = document.getElementById('ludoCanvas');
  const ctx = canvas.getContext('2d');
  const BOARD_SIZE = 15;
  const TILE_SIZE = canvas.width / BOARD_SIZE;

  const SEAT_PALETTES = [
    { main: '#ff2a55', dark: '#b70028', light: '#ff859d', name: 'Red' },
    { main: '#00e676', dark: '#00994c', light: '#70ffb0', name: 'Green' },
    { main: '#ffc400', dark: '#b28900', light: '#ffe17d', name: 'Yellow' },
    { main: '#00b0ff', dark: '#0070ba', light: '#7ad7ff', name: 'Blue' }
  ];

  const HOME_COORDS = [
    { x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }
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
  const PLAYER_START_TILES = [0, 13, 26, 39];

  let animatingTokens = {};
  let isRollingDice = false;

  createBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Player 1';
    socket.emit('createRoom', { playerName: name });
  });

  joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Player';
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!code) return alert('Please enter room code');
    socket.emit('joinRoom', { roomCode: code, playerName: name });
  });

  startBtn.addEventListener('click', () => {
    socket.emit('startGame', { roomCode: currentRoomCode });
  });

  socket.on('errorMsg', (msg) => alert(msg));

  socket.on('roomJoined', ({ room, playerSeat }) => {
    currentRoomCode = room.code;
    myPlayerSeat = playerSeat;

    lobbySec.classList.add('hidden');
    roomSec.classList.remove('hidden');
    displayRoomCode.textContent = room.code;

    updateRoster(room);
  });

  socket.on('roomUpdate', (room) => {
    updateRoster(room);
  });

  function updateRoster(room) {
    playerCount.textContent = room.players.length;
    playersList.innerHTML = '';
    room.players.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'roster-card';
      item.style.borderColor = SEAT_PALETTES[p.seat].main;
      item.innerHTML = `
        <div class="color-dot" style="background: ${SEAT_PALETTES[p.seat].main}"></div>
        <span>${p.name}</span>
      `;
      playersList.appendChild(item);
    });

    if (room.hostId === socket.id) {
      startBtn.classList.remove('hidden');
      waitingText.classList.add('hidden');
    } else {
      startBtn.classList.add('hidden');
      waitingText.classList.remove('hidden');
    }
  }

  socket.on('diceRolled', ({ diceValue }) => {
    triggerDiceRollAnimation(diceValue);
  });

  socket.on('tokenMoved', ({ playerId, tokenId, fromStep, toStep, capturedToken }) => {
    animatePawnPath(playerId, tokenId, fromStep, toStep, () => {
      if (capturedToken) {
        triggerPawnSentHome(capturedToken.playerId, capturedToken.id);
      }
    });
  });

  socket.on('gameStateUpdate', (room) => {
    latestGameState = room;
    if (room.gameStarted) {
      roomSec.classList.add('hidden');
      gameSec.classList.remove('hidden');
      renderHUD(room);
    }
  });

  function triggerDiceRollAnimation(finalValue) {
    if (isRollingDice) return;
    isRollingDice = true;
    dice3D.classList.add('rolling');

    setTimeout(() => {
      dice3D.className = `dice-3d face-${finalValue}`;
      isRollingDice = false;
    }, 550);
  }

  function renderHUD(room) {
    gameRoomId.textContent = room.code;
    const activePlayer = room.players[room.currentTurnSeat];

    turnBadge.textContent = `${activePlayer.name}'s Turn`;
    turnBadge.style.background = SEAT_PALETTES[activePlayer.seat].main;
    gameStatusMsg.textContent = room.statusMessage;

    const isMyTurn = activePlayer.seat === myPlayerSeat;
    rollActionBtn.disabled = !isMyTurn || room.hasRolled || room.winner !== null;

    if (!isRollingDice && room.diceValue) {
      dice3D.className = `dice-3d face-${room.diceValue}`;
    }
  }

  rollActionBtn.addEventListener('click', () => {
    socket.emit('rollDice', { roomCode: currentRoomCode });
  });

  // Step-by-Step Jumping Animation
  function animatePawnPath(playerId, tokenId, fromStep, toStep, onComplete) {
    const key = `${playerId}_${tokenId}`;
    const pathSteps = [];

    if (fromStep === -1) {
      pathSteps.push(0);
    } else {
      for (let s = fromStep + 1; s <= toStep; s++) {
        pathSteps.push(s);
      }
    }

    let stepIdx = 0;
    function nextStep() {
      if (stepIdx >= pathSteps.length) {
        delete animatingTokens[key];
        if (onComplete) onComplete();
        return;
      }

      const currentStepVal = pathSteps[stepIdx];
      const targetPos = calculatePawnCoords(playerId, tokenId, currentStepVal);
      const startPos = animatingTokens[key]
        ? { x: animatingTokens[key].x, y: animatingTokens[key].y }
        : calculatePawnCoords(playerId, tokenId, stepIdx === 0 ? fromStep : pathSteps[stepIdx - 1]);

      const duration = 120;
      const startTime = performance.now();

      function animateFrame(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const hopHeight = Math.sin(progress * Math.PI) * 14;

        animatingTokens[key] = {
          x: startPos.x + (targetPos.x - startPos.x) * progress,
          y: startPos.y + (targetPos.y - startPos.y) * progress - hopHeight,
          playerId,
          id: tokenId,
          step: currentStepVal
        };

        if (progress < 1) {
          requestAnimationFrame(animateFrame);
        } else {
          stepIdx++;
          nextStep();
        }
      }
      requestAnimationFrame(animateFrame);
    }
    nextStep();
  }

  function triggerPawnSentHome(playerId, tokenId) {
    const key = `${playerId}_${tokenId}`;
    const targetPos = calculatePawnCoords(playerId, tokenId, -1);
    const startPos = animatingTokens[key] ? { ...animatingTokens[key] } : calculatePawnCoords(playerId, tokenId, 0);

    const duration = 320;
    const startTime = performance.now();

    function animateBack(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      animatingTokens[key] = {
        x: startPos.x + (targetPos.x - startPos.x) * progress,
        y: startPos.y + (targetPos.y - startPos.y) * progress,
        playerId,
        id: tokenId,
        step: -1
      };

      if (progress < 1) {
        requestAnimationFrame(animateBack);
      } else {
        delete animatingTokens[key];
      }
    }
    requestAnimationFrame(animateBack);
  }

  canvas.addEventListener('click', (e) => {
    if (!latestGameState || !latestGameState.hasRolled || latestGameState.winner !== null) return;
    const activePlayer = latestGameState.players[latestGameState.currentTurnSeat];
    if (activePlayer.seat !== myPlayerSeat) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const clickY = (e.clientY - rect.top) * (canvas.height / rect.height);

    const playerTokens = latestGameState.tokens.filter(t => t.playerId === myPlayerSeat);

    for (const token of playerTokens) {
      const pos = calculatePawnCoords(token.playerId, token.id, token.step);
      const dist = Math.hypot(clickX - pos.x, clickY - pos.y);
      if (dist <= TILE_SIZE * 0.55) {
        socket.emit('moveToken', { roomCode: currentRoomCode, tokenId: token.id });
        break;
      }
    }
  });

  function calculatePawnCoords(playerId, tokenId, step) {
    const baseCoords = HOME_COORDS[playerId];

    if (step === -1) {
      const offsets = [
        { dx: 1.8, dy: 1.8 }, { dx: 3.2, dy: 1.8 },
        { dx: 1.8, dy: 3.2 }, { dx: 3.2, dy: 3.2 }
      ];
      const off = offsets[tokenId];
      return { x: (baseCoords.x + off.dx) * TILE_SIZE, y: (baseCoords.y + off.dy) * TILE_SIZE };
    }

    if (step >= 0 && step <= 50) {
      const start = PLAYER_START_TILES[playerId];
      const globalIdx = (start + step) % 52;
      const tile = MAIN_PATH[globalIdx];
      return { x: (tile.x + 0.5) * TILE_SIZE, y: (tile.y + 0.5) * TILE_SIZE };
    }

    if (step >= 51 && step <= 55) {
      const homeIdx = step - 50;
      let gx = 7, gy = 7;
      if (playerId === 0) { gx = homeIdx; gy = 7; }
      if (playerId === 1) { gx = 7; gy = homeIdx; }
      if (playerId === 2) { gx = 14 - homeIdx; gy = 7; }
      if (playerId === 3) { gx = 7; gy = 14 - homeIdx; }
      return { x: (gx + 0.5) * TILE_SIZE, y: (gy + 0.5) * TILE_SIZE };
    }

    return { x: 7.5 * TILE_SIZE, y: 7.5 * TILE_SIZE };
  }

  function renderLoop() {
    drawBoard();
    drawPawns();
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);

  function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let i = 0; i < BOARD_SIZE; i++) {
      for (let j = 0; j < BOARD_SIZE; j++) {
        ctx.strokeRect(i * TILE_SIZE, j * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }

    drawHomeBase(0, 0, SEAT_PALETTES[0]);
    drawHomeBase(9, 0, SEAT_PALETTES[1]);
    drawHomeBase(9, 9, SEAT_PALETTES[2]);
    drawHomeBase(0, 9, SEAT_PALETTES[3]);

    for (let i = 1; i <= 5; i++) {
      drawSolidTile(i, 7, SEAT_PALETTES[0].main);
      drawSolidTile(7, i, SEAT_PALETTES[1].main);
      drawSolidTile(14 - i, 7, SEAT_PALETTES[2].main);
      drawSolidTile(7, 14 - i, SEAT_PALETTES[3].main);
    }

    SAFE_TILES.forEach(idx => {
      const tile = MAIN_PATH[idx];
      drawStar((tile.x + 0.5) * TILE_SIZE, (tile.y + 0.5) * TILE_SIZE, 5, TILE_SIZE * 0.3, TILE_SIZE * 0.14, '#94a3b8');
    });

    drawCenterTriangles();
  }

  function drawHomeBase(gx, gy, palette) {
    ctx.fillStyle = palette.main;
    ctx.fillRect(gx * TILE_SIZE, gy * TILE_SIZE, 6 * TILE_SIZE, 6 * TILE_SIZE);

    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 8;
    ctx.fillRect((gx + 1) * TILE_SIZE, (gy + 1) * TILE_SIZE, 4 * TILE_SIZE, 4 * TILE_SIZE);
    ctx.shadowBlur = 0;

    const offsets = [
      { dx: 1.8, dy: 1.8 }, { dx: 3.2, dy: 1.8 },
      { dx: 1.8, dy: 3.2 }, { dx: 3.2, dy: 3.2 }
    ];
    offsets.forEach(off => {
      ctx.beginPath();
      ctx.arc((gx + off.dx) * TILE_SIZE, (gy + off.dy) * TILE_SIZE, TILE_SIZE * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = '#f1f5f9';
      ctx.fill();
      ctx.strokeStyle = palette.light;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  function drawSolidTile(gx, gy, color) {
    ctx.fillStyle = color;
    ctx.fillRect(gx * TILE_SIZE, gy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(gx * TILE_SIZE, gy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  }

  function drawCenterTriangles() {
    const cx = 7.5 * TILE_SIZE;
    const cy = 7.5 * TILE_SIZE;

    drawTriangle(6 * TILE_SIZE, 6 * TILE_SIZE, 6 * TILE_SIZE, 9 * TILE_SIZE, cx, cy, SEAT_PALETTES[0].main);
    drawTriangle(6 * TILE_SIZE, 6 * TILE_SIZE, 9 * TILE_SIZE, 6 * TILE_SIZE, cx, cy, SEAT_PALETTES[1].main);
    drawTriangle(9 * TILE_SIZE, 6 * TILE_SIZE, 9 * TILE_SIZE, 9 * TILE_SIZE, cx, cy, SEAT_PALETTES[2].main);
    drawTriangle(6 * TILE_SIZE, 9 * TILE_SIZE, 9 * TILE_SIZE, 9 * TILE_SIZE, cx, cy, SEAT_PALETTES[3].main);
  }

  function drawTriangle(x1, y1, x2, y2, x3, y3, color) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawStar(cx, cy, spikes, outerRadius, innerRadius, color) {
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    let step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * outerRadius;
      y = cy + Math.sin(rot) * outerRadius;
      ctx.lineTo(x, y);
      rot += step;

      x = cx + Math.cos(rot) * innerRadius;
      y = cy + Math.sin(rot) * innerRadius;
      ctx.lineTo(x, y);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawPawns() {
    if (!latestGameState || !latestGameState.tokens) return;

    latestGameState.tokens.forEach(token => {
      const key = `${token.playerId}_${token.id}`;
      let x, y;

      if (animatingTokens[key]) {
        x = animatingTokens[key].x;
        y = animatingTokens[key].y;
      } else {
        const coords = calculatePawnCoords(token.playerId, token.id, token.step);
        x = coords.x;
        y = coords.y;
      }

      render3DPawn(x, y, SEAT_PALETTES[token.playerId], token.step === 56);
    });
  }

  function render3DPawn(x, y, palette, isFinished) {
    const radius = TILE_SIZE * 0.38;

    ctx.save();
    ctx.translate(x, y);

    // Realistic Drop Shadow
    ctx.beginPath();
    ctx.ellipse(0, radius * 0.85, radius * 0.9, radius * 0.35, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fill();

    // Pedestal Base
    const baseGrad = ctx.createLinearGradient(-radius, 0, radius, 0);
    baseGrad.addColorStop(0, isFinished ? '#555' : palette.dark);
    baseGrad.addColorStop(0.5, isFinished ? '#999' : palette.light);
    baseGrad.addColorStop(1, isFinished ? '#333' : palette.dark);

    ctx.beginPath();
    ctx.ellipse(0, radius * 0.45, radius * 0.75, radius * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = baseGrad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Conical Pawn Stem
    ctx.beginPath();
    ctx.moveTo(-radius * 0.5, radius * 0.4);
    ctx.quadraticCurveTo(-radius * 0.2, -radius * 0.2, -radius * 0.25, -radius * 0.55);
    ctx.lineTo(radius * 0.25, -radius * 0.55);
    ctx.quadraticCurveTo(radius * 0.2, -radius * 0.2, radius * 0.5, radius * 0.4);
    ctx.closePath();

    const bodyGrad = ctx.createLinearGradient(-radius * 0.5, 0, radius * 0.5, 0);
    bodyGrad.addColorStop(0, isFinished ? '#444' : palette.dark);
    bodyGrad.addColorStop(0.3, isFinished ? '#aaa' : palette.main);
    bodyGrad.addColorStop(0.6, isFinished ? '#eee' : palette.light);
    bodyGrad.addColorStop(1, isFinished ? '#222' : palette.dark);
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 3D Spherical Head / Crown
    ctx.beginPath();
    ctx.arc(0, -radius * 0.65, radius * 0.45, 0, Math.PI * 2);
    const headGrad = ctx.createRadialGradient(-radius * 0.15, -radius * 0.8, radius * 0.05, 0, -radius * 0.65, radius * 0.45);
    headGrad.addColorStop(0, '#ffffff');
    headGrad.addColorStop(0.3, isFinished ? '#ccc' : palette.light);
    headGrad.addColorStop(0.8, isFinished ? '#555' : palette.main);
    headGrad.addColorStop(1, isFinished ? '#222' : palette.dark);
    ctx.fillStyle = headGrad;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }
});
