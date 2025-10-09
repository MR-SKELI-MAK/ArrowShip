window.addEventListener('DOMContentLoaded', () => {
const socket = io('wss://arrowship.up.railway.app');

let myId = null;
let otherPlayers = [];
let bots = [];
let bullets = [];
let islands = [];
let pickups = [];
let leaderboard = [];
let teammates = [];
let player = null;
let upgradesAvailable = 0;
let level = 1;
let lastLevel = 1;
let currentExp = 0;
let maxHealth = 100;
let fireRateMultiplier = 1;
let multiShotCount = 0;
let hasTeammate = false;

socket.on('connect', () => {
  myId = socket.id;
});

socket.on('gameState', (state) => {
  otherPlayers = Object.entries(state.players)
    .filter(([id, p]) => id !== myId)
    .map(([id, p]) => p);

  player = state.players[myId];

  bots = state.bots;
  bullets = state.bullets;
  islands = state.islands;
  pickups = state.pickups;
  leaderboard = state.leaderboard;
    teammates = state.teammates || [];

  // Sync HUD and upgrades from server state
  if (player) { 
     if (player.level > lastLevel) playLevelUpSound();
    lastLevel = player.level;
    upgradesAvailable = player.upgradesAvailable || 0;
    level = player.level || 1;
    currentExp = player.exp || 0;
    maxHealth = player.maxHealth || 100;
    fireRateMultiplier = player.fireRateMultiplier || 1;
    multiShotCount = player.multiShotCount || 0;
    hasTeammate = player.hasTeammate || false;
    updateUpgradeButtons();
    updateHUD();
    updateLevelBar();
  }
    renderLeaderboard(leaderboard, myId);
});
let gameEnded = false;

socket.on('gameOver', (data) => {
  endGame(data.status);
  gameEnded = true;
  
});

socket.on('dead', () => {
  if (!gameEnded) {
    playKillSound();
    player = null;
    gameState = 'lose';
    document.getElementById('leaderboard').classList.add('hidden');
    endGame('lose');
  }
});

function sendUpgrade(type) {
  socket.emit('upgrade', type);
}

// --- CONSTANTS & SETUP ---
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const usernameAboveShipEl = document.getElementById('usernameAboveShip');
const usernameHudEl = document.getElementById('usernameHud');
const leaderboardListEl = document.getElementById('leaderboardList');
const TAU = Math.PI * 2;
const WORLD_W = 6000;
const WORLD_H = 6000;
let W = canvas.width = innerWidth;
let H = canvas.height = innerHeight;

let gameState = 'menu';
let keys = {};
let mouse = { x: 0, y: 0, down: false };
let playerName = 'Player';
let camera = { x: WORLD_W / 2, y: WORLD_H / 2 };

// --- UTILITY FUNCTIONS ---
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }
function distSq(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy }
function dist(a, b) { return Math.sqrt(distSq(a, b)) }
function getExpNeeded(lvl) {
  if (lvl === 0) return 0;
  return 10 * (2 ** (lvl - 1));
}

// --- HUD & UPGRADE UI ---
function updateHUD() {
  document.getElementById('health').innerText = player ? `Health: ${Math.round(player.health)}% (Max: ${maxHealth})` : 'Health: DEAD';
  document.getElementById('score').innerText = 'Score: ' + (player ? player.score : 0);
  document.getElementById('elimination').innerText = 'Elimination: ' + (player ? player.eliminations : 0);
  document.getElementById('ship').innerText = 'Ships:' + (player ? 1 : 0 + bots.length);
  document.getElementById('island').innerText = 'Islands: ' + islands.length;
}

function updateLevelBar() {
  const nextExp = getExpNeeded(level);
  const expPercent = nextExp === 0 ? 100 : Math.min(100, (currentExp / nextExp) * 100);
  document.getElementById('current-level').innerText = `Level ${level}`;
  document.getElementById('exp-info').innerText = nextExp > 0 ? `${Math.round(currentExp)} / ${nextExp} Exp (${upgradesAvailable} pts)` : `MAX LEVEL (${upgradesAvailable} pts)`;
  document.querySelector('.exp-fill').style.width = `${expPercent}%`;
}

function updateUpgradeButtons() {
  document.querySelectorAll('.upgrade-button').forEach(button => {
    const type = button.dataset.upgrade;
    button.classList.remove('ready');
    button.classList.remove('disabled');
    button.style.color = ''; // Reset color

    if (upgradesAvailable > 0) {
      if (type === 'teammate') {
        if (level >= 5 && !hasTeammate) {
          button.classList.add('ready');
          document.getElementById('teammate-status').innerText = 'Ready to Buy!';
        } else {
          button.classList.add('disabled');
          document.getElementById('teammate-status').innerText = hasTeammate ? 'Acquired' : `Lvl 5 Required`;
        }
      } else if (type === 'multishot' && multiShotCount > 0) {
        button.classList.add('disabled');
        document.getElementById('multishot-status').innerText = 'Acquired';
      } else if (type === 'health') {
        button.classList.add('ready');
        document.getElementById('health-status').innerText = `Max: ${maxHealth}`;
      } else if (type === 'speedyfire') {
        button.classList.add('ready');
        document.getElementById('speedyfire-status').innerText = `Rate: ${fireRateMultiplier.toFixed(2)}x`;
      }
    } else {
      button.classList.add('disabled');
      if (type === 'teammate') {
        document.getElementById('teammate-status').innerText = hasTeammate ? 'Acquired' : `Locked`;
      } else if (type === 'multishot') {
        document.getElementById('multishot-status').innerText = multiShotCount > 0 ? 'Acquired' : 'Not Acquired';
      } else if (type === 'health') {
        document.getElementById('health-status').innerText = `Max: ${maxHealth}`;
      } else if (type === 'speedyfire') {
        document.getElementById('speedyfire-status').innerText = `Rate: ${fireRateMultiplier.toFixed(2)}x`;
      }
    }
  });
}

  function disableUpgradeButtons() {
  document.querySelectorAll('.upgrade-button').forEach(btn => {
    btn.classList.add('disabled');
  });
}


// --- LEADERBOARD ---
function renderLeaderboard(entries, myId) {
  const maxDisplay = 5;
  let html = '';
  let playerInTop = false;
  for (let i = 0; i < Math.min(entries.length, maxDisplay); i++) {
    const entry = entries[i];
    const isYou = entry.id === myId;
    html += `<li${isYou ? ' style="color:var(--health);font-weight:bold;"' : ''}>
      <span class="rank">#${i + 1}</span>
      <span class="name">${entry.username}${isYou ? ' (You)' : ''}</span>
      <span class="stats">${entry.score}</span>
    </li>`;
    if (isYou) playerInTop = true;
  }
  // Add player's rank if outside top 5
  if (!playerInTop && entries.find(e => e.id === myId)) {
    const entry = entries.find(e => e.id === myId);
    html += `<li class="player-rank" style="color:var(--health);font-weight:bold;">
      <span class="rank">#${entries.indexOf(entry) + 1}</span>
      <span class="name">${entry.username} (You)</span>
      <span class="stats">${entry.score}</span>
    </li>`;
  }
  leaderboardListEl.innerHTML = html;
}

// --- GAME LOOP ---
function update(dt) {
  if (gameState !== 'playing') return;
  if (!player) return;

  let dx = mouse.x - W / 2;
  let dy = mouse.y - H / 2;
  let angle = Math.atan2(dy, dx);

  // Only use W/S for movement
  let moveDir = 0;
  if (keys['w'] && !keys['s']) moveDir = 1;
  else if (keys['s'] && !keys['w']) moveDir = -1;
  else moveDir = 0;

  // Optionally, you can set moveSpeed for analog input, but for now just use 1 or -1
  let moveSpeed = 1;

  socket.emit('move', {
    moveDir: moveDir,
    moveSpeed: moveSpeed,
    angle: angle,
    health: player.health
  });

  camera.x = player.x;
  camera.y = player.y;
}

function draw() {
  // Solid background
  ctx.fillStyle = '#07202a';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2 - camera.x, H / 2 - camera.y);

  // --- Subtle grid ---
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = '#1d9db9';
  ctx.lineWidth = 1;
  const step = 200;
  for (let x = Math.floor((camera.x - W / 2) / step) * step; x < camera.x + W / 2 + step; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD_H);
    ctx.stroke();
  }
  for (let y = Math.floor((camera.y - H / 2) / step) * step; y < camera.y + H / 2 + step; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD_W, y);
    ctx.stroke();
  }
  ctx.restore();

  // World boundary
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

  // --- Organic islands ---
for (let isl of islands) {
  ctx.save();
  ctx.translate(isl.x, isl.y);
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = TAU * (i / 7);
    const bump = 0.15;
    const rx = isl.r * (1 + Math.sin(a * 2.5) * bump);
    const ry = isl.r * (1 + Math.cos(a * 3.5) * bump);
    ctx.lineTo(Math.cos(a) * rx, Math.sin(a) * ry);
  }
  ctx.closePath();
  ctx.fillStyle = isl.color || '#155';
  ctx.shadowColor = "#0a1a1a";
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.restore();
}

  // Pickups
  for (let p of pickups) {
    ctx.beginPath();
    ctx.fillStyle = p.color;
    ctx.arc(p.x, p.y, p.r, 0, TAU);
    ctx.fill();
  }

  // Bullets
  for (let b of bullets) {
    ctx.beginPath();
    ctx.fillStyle = '#ffd6a5';
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.fill();
  }

  // Bots
  for (let bot of bots) {
    ctx.save();
    ctx.translate(bot.x, bot.y);
    ctx.rotate(bot.angle);
    ctx.fillStyle = '#ffadad';
    ctx.beginPath();
    ctx.moveTo(18, 0); ctx.lineTo(-10, 12); ctx.lineTo(-6, 0); ctx.lineTo(-10, -12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Health bar
    const barW = 32, barH = 6;
    const currentW = barW * (bot.health / bot.maxHealth);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(bot.x - barW / 2, bot.y - 30, barW, barH);
    ctx.fillStyle = '#ffadad';
    ctx.fillRect(bot.x - barW / 2, bot.y - 30, currentW, barH);
  }
  // After bots, before your player
for (let tm of teammates) {
  ctx.save();
  ctx.translate(tm.x, tm.y);
  ctx.rotate(tm.angle);
  ctx.fillStyle = '#a78bfa';
  ctx.beginPath();
  ctx.moveTo(18, 0); ctx.lineTo(-10, 12); ctx.lineTo(-6, 0); ctx.lineTo(-10, -12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Health bar
  const barW = 32, barH = 6;
  const currentW = barW * (tm.health / tm.maxHealth);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(tm.x - barW / 2, tm.y - 30, barW, barH);
  ctx.fillStyle = '#a78bfa';
  ctx.fillRect(tm.x - barW / 2, tm.y - 30, currentW, barH);
}
  // Other players
  for (let op of otherPlayers) {
  // Draw ship
  ctx.save();
  ctx.translate(op.x, op.y);
  ctx.rotate(op.angle);
  ctx.fillStyle = '#ffeb3b';
  ctx.beginPath();
  ctx.moveTo(18, 0); ctx.lineTo(-10, 12); ctx.lineTo(-6, 0); ctx.lineTo(-10, -12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Draw health bar
  const barW = 32, barH = 6;
  const currentW = barW * (op.health / op.maxHealth);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(op.x - barW / 2, op.y - 30, barW, barH);
  ctx.fillStyle = '#ffeb3b';
  ctx.fillRect(op.x - barW / 2, op.y - 30, currentW, barH);

 // Draw username above ship (same style as your own)
ctx.save();
ctx.font = "bold 16px Arial";
ctx.textAlign = "center";
ctx.globalAlpha = 0.95;
// Draw background with border-radius
ctx.beginPath();
const bgW = 80, bgH = 22, r = 8;
const bgX = op.x - bgW / 2, bgY = op.y - 52;
ctx.moveTo(bgX + r, bgY);
ctx.lineTo(bgX + bgW - r, bgY);
ctx.quadraticCurveTo(bgX + bgW, bgY, bgX + bgW, bgY + r);
ctx.lineTo(bgX + bgW, bgY + bgH - r);
ctx.quadraticCurveTo(bgX + bgW, bgY + bgH, bgX + bgW - r, bgY + bgH);
ctx.lineTo(bgX + r, bgY + bgH);
ctx.quadraticCurveTo(bgX, bgY + bgH, bgX, bgY + bgH - r);
ctx.lineTo(bgX, bgY + r);
ctx.quadraticCurveTo(bgX, bgY, bgX + r, bgY);
ctx.closePath();
ctx.fillStyle = "rgba(10, 14, 20, 0.5)";
ctx.fill();
// Draw text
ctx.fillStyle = "#dbeafe";
ctx.font = "12px Arial";
ctx.fillText(op.username || "Player", op.x, op.y - 35);
ctx.restore();

}

  // Your player
  if (player) {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);
    ctx.fillStyle = '#8bd3ff';
    ctx.beginPath();
    ctx.moveTo(18, 0); ctx.lineTo(-10, 12); ctx.lineTo(-6, 0); ctx.lineTo(-10, -12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Health bar
    const barW = 32, barH = 6;
    const currentW = barW * (player.health / player.maxHealth);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(player.x - barW / 2, player.y - 30, barW, barH);
    ctx.fillStyle = '#8bd3ff';
    ctx.fillRect(player.x - barW / 2, player.y - 30, currentW, barH);
  }

  ctx.restore();

  // Mini map (top right)
  const miniW = 150, miniH = 150;
  const miniX = W - miniW - 24;
  const miniY = 24;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "#07101a";
  ctx.strokeStyle = "#53c6f7";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(miniX, miniY, miniW, miniH);
  ctx.fill();
  ctx.stroke();

  // Islands
  for (let isl of islands) {
    const mx = miniX + (isl.x / WORLD_W) * miniW;
    const my = miniY + (isl.y / WORLD_H) * miniH;
    ctx.beginPath();
    ctx.arc(mx, my, Math.max(2, isl.r * miniW / WORLD_W), 0, TAU);
    ctx.fillStyle = isl.color || "#155";
    ctx.fill();
  }
// Teammates
for (let tm of teammates) {
  const mx = miniX + (tm.x / WORLD_W) * miniW;
  const my = miniY + (tm.y / WORLD_H) * miniH;
  ctx.beginPath();
  ctx.arc(mx, my, 5, 0, TAU);
  ctx.fillStyle = "#a78bfa";
  ctx.fill();
}

  // Bots
  for (let bot of bots) {
    const mx = miniX + (bot.x / WORLD_W) * miniW;
    const my = miniY + (bot.y / WORLD_H) * miniH;
    ctx.beginPath();
    ctx.arc(mx, my, 4, 0, TAU);
    ctx.fillStyle = "#ffadad";
    ctx.fill();
  }
  // Other players
  for (let op of otherPlayers) {
    const mx = miniX + (op.x / WORLD_W) * miniW;
    const my = miniY + (op.y / WORLD_H) * miniH;
    ctx.beginPath();
    ctx.arc(mx, my, 5, 0, TAU);
    ctx.fillStyle = "#ffeb3b";
    ctx.fill();
  }
  // Your player
  if (player) {
    const mx = miniX + (player.x / WORLD_W) * miniW;
    const my = miniY + (player.y / WORLD_H) * miniH;
    ctx.beginPath();
    ctx.arc(mx, my, 6, 0, TAU);
    ctx.fillStyle = "#53c6f7";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // ...existing draw code...

ctx.restore(); // End world/camera transform

// Draw crosshair in screen coordinates
if (gameState === 'playing') {
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.moveTo(mouse.x - 8, mouse.y); ctx.lineTo(mouse.x + 8, mouse.y);
  ctx.moveTo(mouse.x, mouse.y - 8); ctx.lineTo(mouse.x, mouse.y + 8);
  ctx.stroke();
}

}
const music1 = document.getElementById('music1');

// --- GAME LOOP ---
let last = performance.now();
function loop(t) {
  const dt = Math.min(60, t - last);
  last = t;

  update(dt / 16.6667);
  draw();


   // Hide/show in-game menu button
  document.getElementById('inGameMenuBtn').style.display =
    (gameState === 'playing') ? 'block' : 'none';


  // Floating username
  if (player && gameState !== 'menu') {
    const screenX = W / 2 - camera.x + player.x;
    const screenY = H / 2 - camera.y + player.y;
    usernameAboveShipEl.style.left = `${screenX}px`;
    usernameAboveShipEl.style.top = `${screenY - 35}px`;
    usernameAboveShipEl.style.display = 'block';
  } else {
    usernameAboveShipEl.style.display = 'none';
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- INPUT & UI HANDLERS ---
window.addEventListener('resize', () => {
  W = canvas.width = innerWidth;
  H = canvas.height = innerHeight;
});
canvas.addEventListener('mousemove', e => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
});
window.addEventListener('keyup', e => {
  keys[e.key.toLowerCase()] = false;
});

let firing = false;

canvas.addEventListener('mousedown', e => {
  firing = true;
});
canvas.addEventListener('mouseup', e => {
  firing = false;
});
canvas.addEventListener('mouseleave', e => {
  firing = false;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// --- FIRE CONTROL LOOP ---
let lastFireTime = 0;
function fireLoop(t) {
  if (gameState === 'playing' && firing && player) {
    // Only send fire if enough time has passed since last fire (client-side prediction)
    const reloadTime = player.reloadTimeBase ? (player.reloadTimeBase / (player.fireRateMultiplier || 1)) : 50;
    if (t - lastFireTime > reloadTime * 16.6667) { // reloadTime is in server ticks, convert to ms
      socket.emit('fire');
      lastFireTime = t;
    }
  }
  requestAnimationFrame(fireLoop);
}
requestAnimationFrame(fireLoop);

document.getElementById('startBtn').addEventListener('click', () => {
  playerName = document.getElementById('usernameInput').value || 'Player';
  socket.emit('join', playerName);
  usernameAboveShipEl.innerText = playerName;
  usernameHudEl.innerText = 'Username: ' + playerName;
  document.getElementById('overlay').style.display = 'none';
  gameState = 'playing';
  document.getElementById('leaderboard').classList.remove('hidden');
});

document.getElementById('playAgainBtn').addEventListener('click', () => {
  playerName = document.getElementById('usernameInput').value || 'Player';
  socket.emit('join', playerName); 
  usernameAboveShipEl.innerText = playerName;
  usernameHudEl.innerText = 'Username: ' + playerName;
  document.getElementById('gameOverOverlay').style.display = 'none';
  gameState = 'playing';
  document.getElementById('leaderboard').classList.remove('hidden');
});

document.getElementById('returnToMenuBtn').addEventListener('click', () => {
  if (gameState === 'win') {
    location.reload(); // Reload the page on victory
  } else {
    document.getElementById('gameOverOverlay').style.display = 'none';
    document.getElementById('overlay').style.display = 'flex';
    gameState = 'menu';
    player = null;
    disableUpgradeButtons();
    document.getElementById('leaderboard').classList.add('hidden');
  }
});

document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('settingsOverlay').style.display = 'flex';
});
document.getElementById('closeSettingsBtn').addEventListener('click', () => {
  document.getElementById('settingsOverlay').style.display = 'none';
});
document.getElementById('tutorialBtn').addEventListener('click', () => {
  showMessage('Quick Tutorial', 'Controls:\nW/S: Thrust/Reverse\nMouse: Aim & Turn\nClick: Shoot Cannonballs\n\nObjective: \nEliminate all enemy ships, level up by collecting blue experience orbs, and choose upgrades wisely! Green orbs restore health.\n\nShips:\nYellow ship means a real online player.\nRed ship means bots.\nblue ship means you.\n\nGood luck, Captain!');
});

disableUpgradeButtons();
document.getElementById('leaderboard').classList.add('hidden')


const inGameDialog = document.getElementById('inGameDialog');
const resumeBtn = document.getElementById('resumeBtn');
const quitToMenuBtn = document.getElementById('quitToMenuBtn');

// Show dialog when menu button is pressed
inGameMenuBtn.addEventListener('click', () => {
  inGameDialog.style.display = 'flex';
  document.getElementById('leaderboard').classList.remove('hidden')
  playButtonClick();
});

// Resume game
resumeBtn.addEventListener('click', () => {
  inGameDialog.style.display = 'none';
  gameState = 'playing';
  playButtonClick();
});

// Quit to menu
quitToMenuBtn.addEventListener('click', () => {
  inGameDialog.style.display = 'none';
  document.getElementById('overlay').style.display = 'flex';
  gameState = 'menu';
  document.getElementById('leaderboard').classList.add('hidden');
  player = null;
  playButtonClick();
  disableUpgradeButtons();
  
});

// --- Message Box ---
function showMessage(title, text) {
  document.getElementById('messageTitle').innerText = title;
  document.getElementById('messageText').innerText = text;
  document.getElementById('messageBox').style.display = 'flex';
}
document.getElementById('closeMessageBtn').addEventListener('click', () => {
  document.getElementById('messageBox').style.display = 'none';
});


// --- Game Over & Menu Buttons ---
function endGame(status) {
  gameState = status;
  const title = document.getElementById('endGameTitle');
  const message = document.getElementById('endGameMessage');
  document.getElementById('gameOverOverlay').style.display = 'flex';
  usernameAboveShipEl.style.display = 'none';
  document.getElementById('leaderboard').classList.add('hidden');

  // Calculate total ships (players + bots + teammates)
  const totalShips = (otherPlayers ? otherPlayers.length : 0) + (bots ? bots.length : 0) + (player ? 1 : 0);

  if (status === 'win') {
    title.innerText = "VICTORY!";
    title.setAttribute('style', 'text-shadow:0 0 10px var(--multishot);color: var(--multishot);');
    message.innerText = `Congratulations!! You have defeated all ${totalShips} ships! GGZ!`;
    document.getElementById('playAgainBtn').style.display = 'none'; // Hide Play Again on victory
  } else {
    title.innerText = "DEFEAT!";
    title.setAttribute('style', 'text-shadow:0 0 10px var(--fire);color: var(--fire);');
    message.innerText = `Well played! Your ship has been destroyed.`;
    document.getElementById('playAgainBtn').style.display = 'inline-block'; // Show Play Again on defeat
  }

  document.getElementById('endGameUsername').innerText = playerName;
  document.getElementById('finalLevel').innerText = level;
  document.getElementById('eliminations').innerText = player ? player.eliminations : 0;
  document.getElementById('finalScore').innerText = player ? player.score : 0;
}
    // sounds
function playKillSound() {
  document.getElementById('killSound').currentTime = 0;
  document.getElementById('killSound').play();
}
function playButtonClick() {
  document.getElementById('buttonClickSound').currentTime = 0;
  document.getElementById('buttonClickSound').play();
}
function playLevelUpSound() {
  document.getElementById('levelUpSound').currentTime = 0;
  document.getElementById('levelUpSound').play();
}
function playUpgradeSound() {
  document.getElementById('upgradeSound').currentTime = 0;
  document.getElementById('upgradeSound').play();
}
document.querySelectorAll('.botton').forEach(btn => {
  btn.addEventListener('click', playButtonClick);
});
document.querySelectorAll('.upgrade-button').forEach(button => {
  button.addEventListener('click', function() {
    if (upgradesAvailable > 0 && !this.classList.contains('disabled')) {
      playUpgradeSound();
      sendUpgrade(this.dataset.upgrade);
    }
    // If not enough points, do nothing (button is disabled)
  });
});


// --- VOLUME CONTROLS ---
// Get all sound elements
const buttonClickSound = document.getElementById('buttonClickSound');
const killSound = document.getElementById('killSound');
const levelUpSound = document.getElementById('levelUpSound');
const upgradeSound = document.getElementById('upgradeSound');

// Music volume sliders and labels
const musicVolumeSlider = document.getElementById('musicVolume');
const musicVolumeValue = document.getElementById('musicVolumeValue');
const musicVolumeInGame = document.getElementById('musicVolumeInGame');
const musicVolumeValueInGame = document.getElementById('musicVolumeValueInGame');

// Button volume sliders and labels
const buttonVolumeSlider = document.getElementById('buttonVolume');
const buttonVolumeValue = document.getElementById('buttonVolumeValue');
const buttonVolumeInGame = document.getElementById('buttonVolumeInGame');
const buttonVolumeValueInGame = document.getElementById('buttonVolumeValueInGame');

// Unified music volume setter (slider shows 100, actual volume is 0.5)
function setMusicVolume(vol) {
  music1.volume = vol * 0.5;
  levelUpSound.volume = vol * 0.5;
  killSound.volume = vol * 0.5;
  upgradeSound.volume = vol * 0.5;
}

// Unified button volume setter
function setButtonVolume(vol) {
  buttonClickSound.volume = vol * 0.5;
}

// --- SYNC SLIDERS BOTH WAYS ---
// Music volume
musicVolumeSlider.addEventListener('input', function() {
  setMusicVolume(this.value / 100);
  musicVolumeValue.innerText = this.value;
  musicVolumeInGame.value = this.value;
  musicVolumeValueInGame.innerText = this.value;
  
});
musicVolumeInGame.addEventListener('input', function() {
  setMusicVolume(this.value / 100);
  musicVolumeValueInGame.innerText = this.value;
  musicVolumeSlider.value = this.value;
  musicVolumeValue.innerText = this.value;
});

// Button volume
buttonVolumeSlider.addEventListener('input', function() {
  setButtonVolume(this.value / 100);
  buttonVolumeValue.innerText = this.value;
  buttonVolumeInGame.value = this.value;
  buttonVolumeValueInGame.innerText = this.value;
   playButtonClick()
});
buttonVolumeInGame.addEventListener('input', function() {
  setButtonVolume(this.value / 100);
  buttonVolumeValueInGame.innerText = this.value;
  buttonVolumeSlider.value = this.value;
  buttonVolumeValue.innerText = this.value;
   playButtonClick()
});

// --- Set initial volumes and sync both labels/sliders ---
musicVolumeSlider.value = 100;
musicVolumeValue.innerText = 100;
musicVolumeInGame.value = 100;
musicVolumeValueInGame.innerText = 100;
setMusicVolume(1);

buttonVolumeSlider.value = 100;
buttonVolumeValue.innerText = 100;
buttonVolumeInGame.value = 100;
buttonVolumeValueInGame.innerText = 100;
setButtonVolume(1);
document.addEventListener('click', () => {
  music1.play();
});

/* --- MOBILE RESPONSIVENESS & JOYSTICK --- */
function isMobile() {
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
}
function isLandscape() {
  return window.innerWidth > window.innerHeight;
}
function updateMobileUI() {
  if (isMobile()) {
    if (!isLandscape()) {
      document.getElementById('rotateDeviceOverlay').style.display = 'flex';
    } else {
      document.getElementById('rotateDeviceOverlay').style.display = 'none';
    }
    // Show joystick only in game and landscape
    document.getElementById('joystickContainer').style.display =
      (gameState === 'playing' && isLandscape()) ? 'block' : 'none';
  } else {
    document.getElementById('rotateDeviceOverlay').style.display = 'none';
    document.getElementById('joystickContainer').style.display = 'none';
  }
}
window.addEventListener('resize', updateMobileUI);
window.addEventListener('orientationchange', updateMobileUI);
setInterval(updateMobileUI, 500);

/* --- JOYSTICK LOGIC --- */
/* --- JOYSTICK LOGIC (smaller, more precise) --- */
let joystickActive = false, joystickDir = {x:0, y:0};
const joystick = document.getElementById('joystickContainer');
const knob = document.getElementById('joystickKnob');
const base = document.getElementById('joystickBase');
let joyCenter = {x:35, y:35}; // Center for 70x70

function setJoystick(x, y) {
  // Clamp to 25px radius
  let dx = x - joyCenter.x, dy = y - joyCenter.y;
  let dist = Math.sqrt(dx*dx + dy*dy);
  if (dist > 25) {
    dx *= 25/dist; dy *= 25/dist;
    x = joyCenter.x + dx; y = joyCenter.y + dy;
  }
  knob.style.left = (x-17) + "px";
  knob.style.top = (y-17) + "px";
  joystickDir = {x: dx/25, y: dy/25};
}
function resetJoystick() {
  knob.style.left = "18px";
  knob.style.top = "18px";
  joystickDir = {x:0, y:0};
}
joystick.addEventListener('touchstart', function(e) {
  joystickActive = true;
  const t = e.touches[0];
  setJoystick(t.clientX - joystick.getBoundingClientRect().left, t.clientY - joystick.getBoundingClientRect().top);
  e.preventDefault();
});
joystick.addEventListener('touchmove', function(e) {
  if (!joystickActive) return;
  const t = e.touches[0];
  setJoystick(t.clientX - joystick.getBoundingClientRect().left, t.clientY - joystick.getBoundingClientRect().top);
  e.preventDefault();
});
joystick.addEventListener('touchend', function(e) {
  joystickActive = false;
  resetJoystick();
  e.preventDefault();
});
resetJoystick();

/* --- MOBILE AUTO-FIRE & JOYSTICK MOVEMENT --- */
let isMobileAutoFire = false;
function mobileGameLoopPatch() {
  if (isMobile() && gameState === 'playing') {
    if (player) {
      // Joystick moves crosshair only
      if (Math.abs(joystickDir.x) > 0.18 || Math.abs(joystickDir.y) > 0.18) {
        mouse.x = W/2 + joystickDir.x * 80;
        mouse.y = H/2 + joystickDir.y * 80;
        // Ship moves toward crosshair only when joystick is pressed
        keys['w'] = true;
      } else {
        keys['w'] = false;
      }
      keys['s'] = false;
      keys['a'] = false;
      keys['d'] = false;
      firing = keys['w']; // Only autofire when moving
      isMobileAutoFire = keys['w'];
    }
  } else {
    if (isMobileAutoFire) firing = false;
    isMobileAutoFire = false;
  }
  requestAnimationFrame(mobileGameLoopPatch);
}
mobileGameLoopPatch();
document.getElementById('instaLink').addEventListener('click', function(e) {
  var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    // Try to open Instagram app
    window.location = "instagram://user?username=_skeli.thoughts_";
    // Fallback: open in browser after short delay
    setTimeout(function() {
      window.open("https://www.instagram.com/_skeli.thoughts_/", "_blank");
    }, 500);
    e.preventDefault();
  }
});
});