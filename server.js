const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const path = require('path');
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- GRID PARTITIONING ---
const GRID_SIZE = 400;
function getCell(x, y) {
  return {
    cx: Math.floor(x / GRID_SIZE),
    cy: Math.floor(y / GRID_SIZE)
  };
}
let entityGrid = {};
function updateEntityGrid() {
  entityGrid = {};
  // Add bots
  for (const bot of gameState.bots) {
    const {cx, cy} = getCell(bot.x, bot.y);
    const key = `${cx},${cy}`;
    if (!entityGrid[key]) entityGrid[key] = [];
    entityGrid[key].push({ ...bot, _type: 'bot' });
  }
  // Add pickups
  for (const p of gameState.pickups) {
    const {cx, cy} = getCell(p.x, p.y);
    const key = `${cx},${cy}`;
    if (!entityGrid[key]) entityGrid[key] = [];
    entityGrid[key].push({ ...p, _type: 'pickup' });
  }
  // Add islands
  for (const isl of gameState.islands) {
    const {cx, cy} = getCell(isl.x, isl.y);
    const key = `${cx},${cy}`;
    if (!entityGrid[key]) entityGrid[key] = [];
    entityGrid[key].push({ ...isl, _type: 'island' });
  }
  // Add teammates
  for (const tm of gameState.teammates) {
    const {cx, cy} = getCell(tm.x, tm.y);
    const key = `${cx},${cy}`;
    if (!entityGrid[key]) entityGrid[key] = [];
    entityGrid[key].push({ ...tm, _type: 'teammate' });
  }
}
function getNearbyEntities(player, type) {
  const {cx, cy} = getCell(player.x, player.y);
  let nearby = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${cx+dx},${cy+dy}`;
      if (entityGrid[key]) nearby = nearby.concat(entityGrid[key]);
    }
  }
  return nearby.filter(e => e._type === type);
}

// --- CONSTANTS ---
const TAU = Math.PI * 2;
const WORLD_W = 6000;
const WORLD_H = 6000;
const SHIP_COLLISION_RADIUS = 16;
const BULLET_DAMAGE = 20;
const BULLET_SPEED = 10;
const BOT_RELOAD_TIME = 25;
const LEVEL_POINTS_BASE = 10;
const TEAMMATE_LVL_REQ = 5;
const NUM_ISLANDS = 9;
const NUM_BOTS = 5;
const MAX_EXP = 60;
const MAX_HEALTH = 15;

// --- UTILS ---
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(a = 0, b = 1) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function distSq(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy }
function dist(a, b) { return Math.sqrt(distSq(a, b)); }
function findClearPosition(islands, minR = 12) {
  let attempts = 0;
  let p;
  while (attempts < 50) {
    p = { x: rand(30, WORLD_W - 30), y: rand(30, WORLD_H - 30) };
    let clear = true;
    for (const isl of islands) {
      if (dist(p, isl) < isl.r + minR) { clear = false; break; }
    }
    if (clear) return p;
    attempts++;
  }
  return null;
}
function getExpNeeded(lvl) {
  if (lvl === 0) return 0;
  return LEVEL_POINTS_BASE * (2 ** (lvl - 1));
}

// --- GAME STATE ---
let gameState = {
  players: {},
  bots: [],
  bullets: [],
  islands: [],
  pickups: [],
  teammates: [],
  leaderboard: [],
  initialBotCount: 0,
};
let gameActive = true;
spawnWorld();

// --- ENTITY HELPERS ---
function createIsland(islands) {
  const p = findClearPosition(islands, 68) || { x: WORLD_W / 2, y: WORLD_H / 2 };
  return { x: p.x, y: p.y, r: rand(30, 75), color: '#155' };
}
function createShip(x, y, color, isBot = false, isTeammate = false, id = null) {
  return {
    id,
    x, y,
    vx: 0, vy: 0,
    angle: Math.random() * TAU,
    color,
    size: 22,
    collisionR: SHIP_COLLISION_RADIUS,
    maxHealth: 100,
    health: 100,
    reload: 0,
    reloadTimeBase: isBot ? BOT_RELOAD_TIME : 35,
    isBot,
    isTeammate,
    speed: isBot ? 0 :(isTeammate ? 0 : 5.68),
    turnSpeed: isTeammate ? 0.05 : 0.04,
    thrust: isTeammate ? 0.2 : (isBot ? 0.6 : 0.68),
    roamTarget: null,
    roamTimer: 300,
    username: isBot ? null : null,
    level: 1,
    exp: 0,
    upgradesAvailable: 0,
    fireRateMultiplier: 1,
    multiShotCount: 0,
    hasTeammate: false,
    score: 0,
    eliminations: 0,
  };
}
function createPickup(x, y, type) {
   return {
    x, y,
    type,
    t: 1200,
    regen: type === 'health' ? 0 : 0,
    points: type === 'health' ? 0 : randInt(5, 10),
    r: 9,
    color: type === 'health' ? '#a8ffb8' : '#8dd5ff'
  };
}
function createBullet(x, y, angle, ownerId, ownerType) {
  return {
    x, y,
    speed: BULLET_SPEED,
    vx: Math.cos(angle) * BULLET_SPEED,
    vy: Math.sin(angle) * BULLET_SPEED,
    r: 5,
    ownerId,
    ownerType,
    life: 400,
    damage: BULLET_DAMAGE,
  };
}

// --- WORLD SPAWN ---
function spawnWorld() {
  gameState.bots = [];
  gameState.islands = [];
  gameState.bullets = [];
  gameState.pickups = [];
  gameState.teammates = [];
  gameState.initialBotCount = NUM_BOTS;
  const numIslands = NUM_ISLANDS;
  for (let i = 0; i < numIslands; i++) {
    gameState.islands.push(createIsland(gameState.islands));
  }
  for (let i = 0; i < gameState.initialBotCount; i++) {
    const p = findClearPosition(gameState.islands, 50) || { x: WORLD_W / 2, y: WORLD_H / 2 };
    gameState.bots.push(createShip(p.x, p.y, '#ffadad', true , false));
  }
}
let lastTime = Date.now();
// --- GAME LOOP ---
function gameLoop() {
   const now = Date.now();
  const dt = Math.min((now - lastTime) / (1000 / 60), 2); // dt = 1 at 60fps, clamp to avoid spiral of death
  lastTime = now;
  // --- Bot AI ---
 for (const bot of gameState.bots) {
  let nearestPlayer = null;
  let minDistSq = Infinity;
  for (const pid in gameState.players) {
  const p = gameState.players[pid];
  if (p.reload > 0) p.reload -= 1;
  

    const dSq = distSq(bot, p);
    if (dSq < minDistSq) { minDistSq = dSq; nearestPlayer = p; }
  }

  if (nearestPlayer && Math.sqrt(minDistSq) < 1000) {
    // Chase player if within 1000 radius
    const dx = nearestPlayer.x - bot.x;
    const dy = nearestPlayer.y - bot.y;
    const angToT = Math.atan2(dy, dx);
    let da = (angToT - bot.angle + Math.PI) % TAU - Math.PI;
    bot.angle += clamp(da, -bot.turnSpeed, bot.turnSpeed);

    // Momentum: accelerate in facing direction
bot.vx += Math.cos(bot.angle) * bot.thrust * dt;
bot.vy += Math.sin(bot.angle) * bot.thrust * dt;

    // Fire
    if (bot.reload <= 0 && dist(bot, nearestPlayer) < 400) {
      bot.reload = BOT_RELOAD_TIME;
      const bx = bot.x + Math.cos(bot.angle) * (bot.size + 8);
      const by = bot.y + Math.sin(bot.angle) * (bot.size + 8);
      gameState.bullets.push(createBullet(bx, by, bot.angle, null, 'bot'));
    }
  } else {
    // Roam and collect exp orbs
    if (!bot.roamTarget || bot.roamTimer <= 0) {
      // Find nearest exp orb
      let nearestOrb = null;
      let minOrbDist = Infinity;
      for (const orb of gameState.pickups) {
        if (orb.type === 'exp') {
          const d = distSq(bot, orb);
          if (d < minOrbDist) { minOrbDist = d; nearestOrb = orb; }
        }
      }
      if (nearestOrb) {
        bot.roamTarget = { x: nearestOrb.x, y: nearestOrb.y };
        bot.roamTimer = 120 + Math.floor(Math.random() * 120);
      } else {
        // Random roam
        bot.roamTarget = { x: rand(0, WORLD_W), y: rand(0, WORLD_H) };
        bot.roamTimer = 120 + Math.floor(Math.random() * 120);
      }
    }}
    bot.roamTimer--;

    if (bot.roamTarget) {
      const dx = bot.roamTarget.x - bot.x;
      const dy = bot.roamTarget.y - bot.y;
      const angToT = Math.atan2(dy, dx);
      let da = (angToT - bot.angle + Math.PI) % TAU - Math.PI;
      bot.angle += clamp(da, -bot.turnSpeed, bot.turnSpeed);

      bot.vx += Math.cos(bot.angle) * bot.thrust;
      bot.vy += Math.sin(bot.angle) * bot.thrust;

      // If close to target, clear roam target
      if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
        bot.roamTarget = null;
      }
    }

for (const teammate of gameState.teammates) {
  const owner = gameState.players[teammate.ownerId];
  if (owner) {
    // --- Teammate follows owner like a bot ---
    // If far from owner, move toward owner
    const dxOwner = owner.x - teammate.x;
    const dyOwner = owner.y - teammate.y;
    const distToOwner = Math.sqrt(dxOwner * dxOwner + dyOwner * dyOwner);

    let targetX = owner.x, targetY = owner.y;

    // If close to owner, wander randomly
    if (distToOwner < 120) {
      if (!teammate.roamTarget || teammate.roamTimer <= 0) {
        teammate.roamTarget = {
          x: owner.x + rand(-80, 80),
          y: owner.y + rand(-80, 80)
        };
        teammate.roamTimer = 60 + Math.floor(Math.random() * 60);
      }
      targetX = teammate.roamTarget.x;
      targetY = teammate.roamTarget.y;
      teammate.roamTimer--;
      // If close to roam target, clear it
      if (Math.abs(teammate.x - targetX) < 10 && Math.abs(teammate.y - targetY) < 10) {
        teammate.roamTarget = null;
      }
    }

    // Move toward target (owner or roam target)
    const dx = targetX - teammate.x;
    const dy = targetY - teammate.y;
    const angleToTarget = Math.atan2(dy, dx);
    let da = (angleToTarget - teammate.angle + Math.PI) % TAU - Math.PI;
    teammate.angle += clamp(da, -teammate.turnSpeed, teammate.turnSpeed);

teammate.vx += Math.cos(teammate.angle) * teammate.thrust * 0.08 * dt;
teammate.vy += Math.sin(teammate.angle) * teammate.thrust * 0.08 * dt;

    // Friction
    teammate.vx *= 0.98;
    teammate.vy *= 0.98;

    // Move teammate
    let nextX = teammate.x + teammate.vx;
    let nextY = teammate.y + teammate.vy;

    // Prevent teammate from going through islands
    let blocked = false;
    for (const isl of gameState.islands) {
      const dx = nextX - isl.x;
      const dy = nextY - isl.y;
      if (Math.sqrt(dx * dx + dy * dy) < isl.r + teammate.collisionR) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      teammate.x = clamp(nextX, teammate.collisionR, WORLD_W - teammate.collisionR);
      teammate.y = clamp(nextY, teammate.collisionR, WORLD_H - teammate.collisionR);
    } else {
      teammate.vx *= -0.5;
      teammate.vy *= -0.5;
    }

    // --- Attack nearest enemy (bot or enemy player) ---
    let nearestTarget = null;
    let minDist = Infinity;
    // Find nearest bot
    for (const bot of gameState.bots) {
      const d = dist(teammate, bot);
      if (d < minDist) { minDist = d; nearestTarget = bot; }
    }
    // Find nearest enemy player
    for (const pid in gameState.players) {
      if (pid !== teammate.ownerId) {
        const p = gameState.players[pid];
        const d = dist(teammate, p);
        if (d < minDist) { minDist = d; nearestTarget = p; }
      }
    }
    // Fire if in range and reloaded
    const TEAMMATE_RELOAD_TIME = 200; // About 2 shots per second at 120 FPS

    if (nearestTarget && minDist < 400 && teammate.reload === 0) {
      teammate.reload = TEAMMATE_RELOAD_TIME;
      const angleToTarget = Math.atan2(nearestTarget.y - teammate.y, nearestTarget.x - teammate.x);
      const bx = teammate.x + Math.cos(angleToTarget) * (teammate.size + 8);
      const by = teammate.y + Math.sin(angleToTarget) * (teammate.size + 8);
      gameState.bullets.push(createBullet(bx, by, angleToTarget, teammate.ownerId, 'teammate'));
    }
    if (teammate.reload > 0) teammate.reload--;
  }
}

  bot.reload = Math.max(0, bot.reload - 1);

    // Friction
    bot.vx *= 0.98;
    bot.vy *= 0.98;

    // Move bot
    let nextX = bot.x + bot.vx;
    let nextY = bot.y + bot.vy;

    // Prevent bot from going through islands
    let blocked = false;
    for (const isl of gameState.islands) {
      const dx = nextX - isl.x;
      const dy = nextY - isl.y;
      if (Math.sqrt(dx * dx + dy * dy) < isl.r + bot.collisionR) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      bot.x = clamp(nextX, bot.collisionR, WORLD_W - bot.collisionR);
      bot.y = clamp(nextY, bot.collisionR, WORLD_H - bot.collisionR);
    } else {
      // Bounce back if blocked
      bot.vx *= -0.5;
      bot.vy *= -0.5;
    }
  }

  // --- Player momentum ---
for (const pid in gameState.players) {
  const p = gameState.players[pid];
  if (typeof p.nextMove === 'object') {
    const moveDir = p.nextMove.moveDir || 0; // 1 = forward, -1 = backward, 0 = none
    const angle = p.nextMove.angle || p.angle;

    if (!p.vx) p.vx = 0;
    if (!p.vy) p.vy = 0;

    // Forward/backward thrust
    if (moveDir === 1) {
        p.vx += Math.cos(angle) * p.thrust * dt;
        p.vy += Math.sin(angle) * p.thrust * dt;
      } else if (moveDir === -1) {
        p.vx -= Math.cos(angle) * p.thrust * 0.5 * dt;
        p.vy -= Math.sin(angle) * p.thrust * 0.5 * dt;
      }
    // Friction
    p.vx *= 0.98;
    p.vy *= 0.98;

    // Move player
    let nextX = p.x + p.vx;
    let nextY = p.y + p.vy;

    // Prevent player from going through islands
    let blocked = false;
    for (const isl of gameState.islands) {
      const dx = nextX - isl.x;
      const dy = nextY - isl.y;
      if (Math.sqrt(dx * dx + dy * dy) < isl.r + p.collisionR) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      p.x = clamp(nextX, p.collisionR, WORLD_W - p.collisionR);
      p.y = clamp(nextY, p.collisionR, WORLD_H - p.collisionR);
    } else {
      p.vx *= -0.5;
      p.vy *= -0.5;
    }

    p.angle = angle;
    delete p.nextMove;
  }
}
  // Ship-I
  // sland Collisions
const allShips = [
  ...Object.values(gameState.players),
  ...gameState.bots,
  ...gameState.teammates
].filter(s => s);

for (let s of allShips) {
  for (let isl of gameState.islands) {
    const combinedR = isl.r + s.collisionR;
    const d = dist(s, isl);
    if (d < combinedR) {
      const ang = Math.atan2(s.y - isl.y, s.x - isl.x);
      const overlap = combinedR - d;
      s.x += Math.cos(ang) * overlap;
      s.y += Math.sin(ang) * overlap;
      s.health = clamp(s.health - 0.04 * overlap, 0, s.maxHealth); // Damage
      s.vx = (s.vx || 0) * 0.5;
      s.vy = (s.vy || 0) * 0.5;
    }
  }
}

// Update bullets

for (const bullet of gameState.bullets) {
bullet.x += bullet.vx * dt;
bullet.y += bullet.vy * dt;
  bullet.life -= 1;
  if (
    bullet.life <= 0 ||
    bullet.x < 0 || bullet.x > WORLD_W ||
    bullet.y < 0 || bullet.y > WORLD_H
  ) {
    bullet._destroy = true;
    continue;
  }

  // --- Damage bots ---
  if (bullet.ownerType === 'player' || bullet.ownerType === 'teammate') {
    for (const bot of gameState.bots) {
      if (distSq(bullet, bot) < (bot.collisionR + bullet.r) ** 2) {
        bot.health -= bullet.damage;
        if (bot.health <= 0) {
          bot.health = 0;
          bot._destroy = true;
          // Score/elimination to player or teammate's owner
          let scorerId = bullet.ownerId;
          if (scorerId && gameState.players[scorerId]) {
            gameState.players[scorerId].score += 100;
            gameState.players[scorerId].eliminations += 1;
          }
        }
        bullet._destroy = true;
      }
    }
    // --- PvP: Damage other players (not self) ---
    for (const pid in gameState.players) {
      const target = gameState.players[pid];
      if (
        pid !== bullet.ownerId &&
        distSq(bullet, target) < (target.collisionR + bullet.r) ** 2
      ) {
        target.health -= bullet.damage;
        if (target.health <= 0) {
          target.health = 0;
          let scorerId = bullet.ownerId;
          if (scorerId && gameState.players[scorerId]) {
            gameState.players[scorerId].score += 200;
            gameState.players[scorerId].eliminations += 1;
          }
        }
        bullet._destroy = true;
      }
    }
  }

  // --- Damage teammates (except from their owner) ---
for (const teammate of gameState.teammates) {
  // Only damage if bullet.ownerId !== teammate.ownerId
  if (
    bullet.ownerId !== teammate.ownerId &&
    distSq(bullet, teammate) < (teammate.collisionR + bullet.r) ** 2
  ) {
    teammate.health -= bullet.damage;
    if (teammate.health <= 0) teammate.health = 0;
    bullet._destroy = true;
  }
}

  // --- Damage players from bot bullets ---
  if (bullet.ownerType === 'bot') {
    for (const pid in gameState.players) {
      const p = gameState.players[pid];
      if (distSq(bullet, p) < (p.collisionR + bullet.r) ** 2) {
        p.health -= bullet.damage;
        if (p.health <= 0) p.health = 0;
        bullet._destroy = true;
      }
    }
  }

  // --- Damage teammates from bot bullets ---
  if (bullet.ownerType === 'bot') {
    for (const teammate of gameState.teammates) {
      if (distSq(bullet, teammate) < (teammate.collisionR + bullet.r) ** 2) {
        teammate.health -= bullet.damage;
        if (teammate.health <= 0) teammate.health = 0;
        bullet._destroy = true;
      }
    }
  }

  // --- Collision with islands ---
  for (const isl of gameState.islands) {
    if (distSq(bullet, isl) < (isl.r + bullet.r) ** 2) {
      bullet._destroy = true;
    }
  }
}
  // Remove destroyed bullets/bots
  gameState.bullets = gameState.bullets.filter(b => !b._destroy);
  gameState.bots = gameState.bots.filter(b => !b._destroy);

   gameState.teammates = gameState.teammates.filter(tm => {
  if (tm.health <= 0) {
    if (tm.ownerId && gameState.players[tm.ownerId]) {
      gameState.players[tm.ownerId].hasTeammate = false;
    }
    return false;
  }
  return true;
});
  // Pickups: spawn and collect
// Count current exp and health pickups
let expCount = 0, healthCount = 0;
for (const p of gameState.pickups) {
  if (p.type === 'exp') expCount++;
  if (p.type === 'health') healthCount++;
}



if (expCount < MAX_EXP) {
  for (let i = 0; i < (MAX_EXP - expCount); i++) {
    const pos = findClearPosition(gameState.islands, 13);
    if (pos) gameState.pickups.push(createPickup(pos.x, pos.y, 'exp'));
  }
}
if (healthCount < MAX_HEALTH) {
  for (let i = 0; i < (MAX_HEALTH - healthCount); i++) {
    const pos = findClearPosition(gameState.islands, 13);
    if (pos) gameState.pickups.push(createPickup(pos.x, pos.y, 'health'));
  }
}
  for (const pid in gameState.players) {
  const p = gameState.players[pid];
  for (const pickup of gameState.pickups) {
    if (distSq(p, pickup) < (pickup.r + p.collisionR) ** 2) {
      if (pickup.type === 'health') {
        const heal = Math.round(p.maxHealth * 0.3);
        p.health = clamp(p.health + heal, 0, p.maxHealth);
      } else if (pickup.type === 'exp') {
        p.exp += pickup.points;
        p.score += 5;
        // Level up
        while (p.exp >= getExpNeeded(p.level)) {
          p.exp -= getExpNeeded(p.level);
          p.level++;
          p.upgradesAvailable++;
        }
      }
      pickup._destroy = true;
    }
  }
}  gameState.pickups = gameState.pickups.filter(p => !p._destroy);

  updateEntityGrid();

  // --- Per-player filtered emit using grid ---
  for (const pid in gameState.players) {
    const player = gameState.players[pid];
    if (!player) continue;

    // Use grid for filtering
    const visibleBots = getNearbyEntities(player, 'bot');
    const visiblePickups = getNearbyEntities(player, 'pickup');
    const visibleIslands = getNearbyEntities(player, 'island');
    const visibleTeammates = getNearbyEntities(player, 'teammate');
    // Bullets: still filter by distance (or add to grid if you want)
    const isNear = (e, margin = 600) =>
      Math.abs(e.x - player.x) < margin && Math.abs(e.y - player.y) < margin;
    const visibleBullets = gameState.bullets.filter(b => isNear(b));
    const visiblePlayers = {};
    for (const opid in gameState.players) {
      if (isNear(gameState.players[opid])) visiblePlayers[opid] = gameState.players[opid];
    }

    // Minimap data (all entities, always)
    const minimapData = {
      players: Object.values(gameState.players).map(p => ({ x: p.x, y: p.y, id: p.id })),
      bots: gameState.bots.map(b => ({ x: b.x, y: b.y })),
      pickups: gameState.pickups.map(p => ({ x: p.x, y: p.y, type: p.type })),
      islands: gameState.islands.map(i => ({ x: i.x, y: i.y, r: i.r })),
      teammates: gameState.teammates.map(tm => ({ x: tm.x, y: tm.y }))
    };

    io.to(pid).emit('gameState', {
      players: visiblePlayers,
      bots: visibleBots,
      bullets: visibleBullets,
      islands: visibleIslands,
      pickups: visiblePickups,
      leaderboard: gameState.leaderboard,
      initialBotCount: gameState.initialBotCount,
      teammates: visibleTeammates,
      minimap: minimapData,
    });
  }
// Place this BEFORE removing dead players!
const playerIds = Object.keys(gameState.players);
const aliveBots = gameState.bots.filter(b => b.health > 0);

if (
  playerIds.length === 1 && // Only one player left in the game
  aliveBots.length === 0    // No bots left
) {
  const winnerId = playerIds[0];
  io.to(winnerId).emit('gameOver', { status: 'win' });
  gameActive = false;
  // Optionally, you can emit 'lose' to others, but there are none left
}
  // Remove dead players
  for (const pid in gameState.players) {
  const p = gameState.players[pid];
  if (p.health <= 0) {
    // Spawn health and exp at death location
    gameState.pickups.push(createPickup(p.x, p.y, 'health'));
    gameState.pickups.push(createPickup(p.x + rand(-20, 20), p.y + rand(-20, 20), 'exp'));
    io.to(pid).emit('dead');
    delete gameState.players[pid];
  }
}

  // Leaderboard
gameState.leaderboard = Object.values(gameState.players)
  .map(p => ({
    id: p.id,
    username: p.username,
    score: p.score,
    eliminations: p.eliminations,
    rankValue: p.score + p.eliminations * 100,
  }))
  .sort((a, b) => b.rankValue - a.rankValue);
  setTimeout(gameLoop, 1000 / 60); // 60 FPS
}

// --- SOCKET HANDLERS ---
io.on('connection', (socket) => {
 console.log('New connection:', socket.id);
  socket.on('join', (username) => {
    console.log('Player joined:', username, socket.id);
     // If world ended or no players, respawn world
  if (!gameActive || Object.keys(gameState.players).length === 0) {
    spawnWorld();
    gameActive = true;
  }
    const pPos = findClearPosition(gameState.islands, 50) || { x: WORLD_W / 2, y: WORLD_H / 2 };
    gameState.players[socket.id] = createShip(pPos.x, pPos.y, '#8bd3ff', false , socket.id);
    gameState.players[socket.id].username = username;
      console.log('Player added:', Object.keys(gameState.players));
  console.log('Player health after join:', gameState.players[socket.id].health);
  console.log('Player position after join:', pPos);
  });

  // Player input: movement, angle, shooting
socket.on('move', (data) => {
  const p = gameState.players[socket.id];
  console.log('Move event from', socket.id, data);
  if (!p) return;
  // Store next move for momentum logic
  p.nextMove = data;
});

  // Player fires bullet
 socket.on('fire', () => {
  const p = gameState.players[socket.id];
  if (!p || p.reload > 0) return; // Only fire if reload is 0
  p.reload = p.reloadTimeBase / p.fireRateMultiplier; // Set reload
  const bx = p.x + Math.cos(p.angle) * (p.size + 8);
  const by = p.y + Math.sin(p.angle) * (p.size + 8);
  gameState.bullets.push(createBullet(bx, by, p.angle, socket.id, 'player'));
  // Multishot
  if (p.multiShotCount > 0) {
    gameState.bullets.push(createBullet(bx, by, p.angle + 0.1, socket.id, 'player'));
    gameState.bullets.push(createBullet(bx, by, p.angle - 0.1, socket.id, 'player'));
  }
});

  // Player upgrades
  socket.on('upgrade', (type) => {
    const p = gameState.players[socket.id];
    if (!p || p.upgradesAvailable <= 0) return;
    switch (type) {
      case 'health':
        p.maxHealth += 50;
        p.health = clamp(p.health + 50, 0, p.maxHealth);
        break;
      case 'multishot':
        p.multiShotCount = 1;
        break;
      case 'speedyfire':
        p.fireRateMultiplier *= 1.2;
        p.reloadTimeBase /= 0.9;
        break;
       case 'teammate':
  if (p.level >= TEAMMATE_LVL_REQ && !p.hasTeammate) {
    p.hasTeammate = true;
    // Spawn teammate near player, random direction
    const angle = rand(0, TAU);
    const distFromPlayer = rand(80, 120); // Slightly farther away
    const tx = p.x + Math.cos(angle) * distFromPlayer;
    const ty = p.y + Math.sin(angle) * distFromPlayer;
    gameState.teammates.push({
      ...createShip(tx, ty, '#a78bfa', false, true),
      ownerId: socket.id,
      vx: 0,
      vy: 0,
      reload: 0 
    });
  }
  break;
    }
    p.upgradesAvailable--;
  });

  socket.on('disconnect', () => {
    delete gameState.players[socket.id];
      // If no players left, respawn world
    if (Object.keys(gameState.players).length === 0) {
      spawnWorld();
      gameActive = false;
    }
  });
});
// server.listen(3000, () => console.log('Server running on http://localhost:3000'));
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://0.0.0.0:${PORT}`));

gameLoop();

