"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const levelEl = document.getElementById("level");

/* ================== CONFIGURACIÓN ================== */
const box = 15;
const baseSize = 450;
const cols = Math.floor(baseSize / box);
const rows = Math.floor(baseSize / box);

// Los valores de movimiento/tiempos de los bosses se diseñaron para un tick de 120 ms
// (la velocidad inicial de la serpiente). Se convierten a tiempo real con BASE_TICK_MS,
// así ya no dependen de la velocidad actual de la serpiente.
const BASE_TICK_MS = 120;
const POISON_TICK_MS = 500; // daño de veneno cada 0.5 s (como decían los comentarios originales)
const BURN_TICK_MS = 333; // daño de quemadura cada ~0.33 s
const BOSS_DOUBLE_FROM_LEVEL = 10; // antes: siempre 2 bosses desde el nivel 5
const OBSTACLE_SCALE = 2.0; // tamaño visual del obstáculo (antes 3.4 celdas)
const COIN_SCALE = 2.4; // tamaño visual del alma (antes 3.1 celdas)
const OBSTACLE_SAFE_CELLS = 4; // un obstáculo nuevo nunca aparece a menos de 4 celdas de la cabeza

/* ================== CANVAS NÍTIDO (devicePixelRatio) ================== */
// Resolución interna alta, pero todo el código sigue dibujando en coordenadas de 450x450.
const dpr = Math.min(window.devicePixelRatio || 1, 3);
canvas.width = baseSize * dpr;
canvas.height = baseSize * dpr;
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
ctx.imageSmoothingQuality = "high";

// shadowBlur no se escala con la transformación, así que se compensa aquí.
const setGlow = (n) => {
  ctx.shadowBlur = n * dpr;
};

/* ================== ALMACENAMIENTO SEGURO ================== */
function storageGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}
function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    /* modo privado o almacenamiento bloqueado: se ignora */
  }
}

/* ================== SKINS ================== */
const skins = [
  {
    name: "Classic",
    head: "#aa9871",
    body: "#d49c34",
    glow: "#8f8d25",
    price: 0,
    ability: "none",
    abilityName: "Sin habilidad",
    energyCost: 0,
  },
  {
    name: "Blue",
    head: "#54aef7",
    body: "#90CAF9",
    glow: "#2e9efa",
    price: 50,
    ability: "lightning",
    abilityName: "Rayo",
    abilityDesc: "Daño eléctrico a boss",
    energyCost: 50,
    duration: 1000,
  },
  {
    name: "Purple",
    head: "#9C27B0",
    body: "#CE93D8",
    glow: "#9C27B0",
    price: 75,
    ability: "poison",
    abilityName: "Veneno",
    abilityDesc: "Envenena a un boss",
    energyCost: 60,
    duration: 8000,
  },
  {
    name: "Gold",
    head: "#d6ba1c",
    body: "#FFF176",
    glow: "#FFD700",
    price: 150,
    ability: "golden_shield",
    abilityName: "Escudo Dorado",
    abilityDesc: "Inmune + ralentiza",
    energyCost: 70,
    duration: 5000,
  },
  {
    name: "Infernal",
    head: "#5c0606",
    body: "#120000",
    glow: "#ff0000",
    price: 300,
    ability: "infernal_burst",
    abilityName: "Infierno",
    abilityDesc: "Quema + Explosión",
    energyCost: 80,
    duration: 6000,
    infernal: true,
  },
];

/* ================== PROGRESO GUARDADO ================== */
function loadUnlockedSkins() {
  try {
    const arr = JSON.parse(storageGet("unlockedSkins", "null"));
    if (Array.isArray(arr) && arr.length === skins.length) {
      const fixed = arr.map(Boolean);
      fixed[0] = true;
      return fixed;
    }
  } catch (e) {
    /* JSON corrupto: se usan los valores por defecto */
  }
  return skins.map((_, i) => i === 0);
}

let unlockedSkins = loadUnlockedSkins();
let skinIndex = Number(storageGet("skinIndex", "0")) || 0;
if (!skins[skinIndex] || !unlockedSkins[skinIndex]) skinIndex = 0;
let coins = Number(storageGet("coins", "0")) || 0;
let highScore = Number(storageGet("highScore", "0")) || 0;
let muted = storageGet("muted", "0") === "1";
let newRecord = false;

function saveProgress() {
  storageSet("coins", String(coins));
  storageSet("skinIndex", String(skinIndex));
  storageSet("unlockedSkins", JSON.stringify(unlockedSkins));
  storageSet("highScore", String(highScore));
}

/* ================== ESTADO ================== */
let snake,
  food,
  coin = null,
  direction;
let score = 0,
  level = 1,
  speed = 120;
let paused = false,
  gameOver = false;
let screen = "menu";
let pauseLock = false;
let lastLevelGenerated = 1;

// Reloj de juego (ms): solo avanza mientras se juega. Las habilidades y efectos lo usan,
// así que la pausa ya no los consume.
let gameTime = 0;
let accumulator = 0;
let lastFrame = 0;

// Cola de giros: evita el giro de 180° al pulsar dos direcciones entre ticks.
let inputQueue = [];
const OPPOSITE = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };

// Energía y habilidades
let energy = 100;
const maxEnergy = 100;
let abilityActive = false;
let abilityEndTime = 0;

// Efectos de estado en bosses (guardan la referencia al boss, no su índice)
let poisonedBosses = []; // {boss, endTime, timer}
let burningBosses = []; // {boss, endTime, timer}
let lightningEffect = null; // {x, y, targetX, targetY, endTime, blocked}

/* ================== IMÁGENES ================== */
function loadImg(src) {
  const o = { img: new Image(), ok: false };
  o.img.onload = () => (o.ok = true);
  o.img.src = src;
  return o;
}

const snakeHeads = [];
const snakeBodies = [];
for (let i = 0; i < skins.length; i++) {
  snakeHeads.push(loadImg(`icon/snake_head_${i}.webp`));
  snakeBodies.push(loadImg(`icon/snake_body_${i}.webp`));
}

const stalactite = loadImg("icon/estalactita.webp");
const soul = loadImg("icon/soul.webp");
const bgImage = loadImg("icon/Escenario.webp");

// La calavera usa el emoji 💀 como arte. Para usar tu propia imagen, súbela y descomenta:
// const bossSkull = loadImg("icon/boss_skull.webp");
const bossSkull = null;

/* ================== SONIDOS Y MÚSICA ================== */
const eatSound = new Audio("sounds/bite.mp3");
const soulSound = new Audio("sounds/coin.mp3");
const gameOverSound = new Audio("sounds/game_over.mp3");
const hitSound = new Audio("sounds/hit.mp3");
eatSound.volume = 0.5;
soulSound.volume = 0.6;
gameOverSound.volume = 0.7;
hitSound.volume = 0.6;

const menuMusic = new Audio("sounds/sound_menu.mp3");
const gameMusic = new Audio("sounds/music_game.mp3");
const bossFightMusic = new Audio("sounds/fight_boss.mp3");
menuMusic.loop = gameMusic.loop = bossFightMusic.loop = true;
menuMusic.volume = 0.3;
gameMusic.volume = 0.4;
bossFightMusic.volume = 0.5;

const tracks = { menu: menuMusic, game: gameMusic, boss: bossFightMusic };
const allAudio = [eatSound, soulSound, gameOverSound, hitSound, menuMusic, gameMusic, bossFightMusic];
let currentTrack = null;

function play(sound) {
  sound.currentTime = 0;
  sound.play().catch(() => {});
}

// Cambia de pista: pausa las demás y reproduce la pedida (null = silencio).
function setMusic(name) {
  for (const key in tracks) {
    if (key !== name) {
      tracks[key].pause();
      tracks[key].currentTime = 0;
    }
  }
  currentTrack = name;
  if (name) {
    const a = tracks[name];
    if (a.paused) {
      a.currentTime = 0;
      a.play().catch(() => {});
    }
  }
}

function applyMute() {
  allAudio.forEach((a) => (a.muted = muted));
  const btn = document.getElementById("mute-btn");
  if (btn) {
    btn.textContent = muted ? "🔇" : "🔊";
    btn.setAttribute("aria-pressed", String(muted));
    btn.setAttribute("aria-label", muted ? "Activar sonido" : "Silenciar");
  }
}

// Los navegadores bloquean el audio hasta la primera interacción: se reintenta en cada una.
function resumeMusicOnInteraction() {
  if (currentTrack && tracks[currentTrack].paused && !document.hidden) {
    tracks[currentTrack].play().catch(() => {});
  }
}
window.addEventListener("pointerdown", resumeMusicOnInteraction);
window.addEventListener("keydown", resumeMusicOnInteraction);

/* ================== UTIL ================== */
const randPos = () => ({
  x: Math.floor(Math.random() * cols) * box,
  y: Math.floor(Math.random() * rows) * box,
});

const same = (a, b) => a && b && a.x === b.x && a.y === b.y;

function spawnFood() {
  let p;
  let tries = 0;
  do {
    p = randPos();
    tries++;
  } while (
    tries < 500 &&
    (snake.some((s) => same(s, p)) ||
      obstacles.some((o) => same(o, p)) ||
      same(coin, p) ||
      bosses.some(
        (b) => p.x >= b.x - box && p.x <= b.x + b.width && p.y >= b.y - box && p.y <= b.y + b.height,
      ))
  );
  food = p;
}

/* ================== OBSTÁCULOS ================== */
let obstacles = [];

function generateObstacles() {
  obstacles = [];
  if (level < 2) return;

  let count = 3;
  if (level >= 5) count = 4;
  if (level >= 8) count = 5;

  const head = snake[0];
  let tries = 0;
  while (obstacles.length < count && tries < 300) {
    tries++;
    const p = randPos();

    // Nunca cerca de la cabeza (en celdas), para que no haya muertes injustas.
    const cellsAway = (Math.abs(p.x - head.x) + Math.abs(p.y - head.y)) / box;
    const invalid =
      cellsAway <= OBSTACLE_SAFE_CELLS ||
      snake.some((s) => same(s, p)) ||
      same(food, p) ||
      same(coin, p) ||
      obstacles.some((o) => same(o, p));

    if (!invalid) obstacles.push(p);
  }
}

/* ================== BOSSES ================== */
let bosses = [];
let bossProjectiles = [];

function createBoss(lvl) {
  bosses = [];

  // 1 boss al principio; 2 a partir de BOSS_DOUBLE_FROM_LEVEL
  const count = lvl >= BOSS_DOUBLE_FROM_LEVEL ? 2 : 1;

  let bossTypes = [];
  if (count === 1) {
    bossTypes = [Math.random() < 0.5 ? "soul" : "skull"];
  } else {
    const rand = Math.random();
    if (rand < 0.33) bossTypes = ["skull", "skull"];
    else if (rand < 0.66) bossTypes = ["soul", "soul"];
    else bossTypes = ["skull", "soul"];
  }

  for (let i = 0; i < count; i++) {
    const type = bossTypes[i];
    let newBoss;
    if (type === "soul") {
      // Boss Alma - teletransporte y escudo
      newBoss = {
        type: "soul",
        x: count === 1 ? baseSize / 2 - 40 : i === 0 ? baseSize / 4 - 40 : (baseSize * 3) / 4 - 40,
        y: 30,
        width: 80,
        height: 80,
        health: 18,
        maxHealth: 18,
        speed: 2,
        direction: 1,
        shootTimer: Math.floor(Math.random() * 40),
        shootInterval: 60,
        movePattern: "horizontal",
        projectileType: "energy",
        ability: "teleport_shield",
        abilityTimer: 0,
        abilityInterval: 180,
        abilityActive: false,
        abilityDuration: 0,
      };
    } else {
      // Boss Calavera - lluvia de estalactitas
      newBoss = {
        type: "skull",
        x: count === 1 ? baseSize / 2 - 30 : i === 0 ? baseSize / 4 - 30 : (baseSize * 3) / 4 - 30,
        y: 30,
        width: 60,
        height: 60,
        health: 22,
        maxHealth: 22,
        speed: 1.5,
        direction: 1,
        shootTimer: Math.floor(Math.random() * 40),
        shootInterval: 70,
        movePattern: "horizontal",
        projectileType: "stalactite",
        ability: "stalactite_rain",
        abilityTimer: 0,
        abilityInterval: 240,
        abilityActive: false,
        abilityDuration: 0,
      };
    }
    bosses.push(newBoss);
  }

  bossProjectiles = [];
  poisonedBosses = [];
  burningBosses = [];
  obstacles = []; // sin obstáculos durante la pelea

  setMusic("boss");
}

// Elimina bosses sin vida (por comida, veneno, quemadura o rayo) y termina la pelea si era el último.
function checkBossDeaths() {
  if (bosses.length === 0) return;
  bosses = bosses.filter((b) => b.health > 0);
  if (bosses.length === 0) endBossFight();
}

function endBossFight() {
  bossProjectiles = [];
  poisonedBosses = [];
  burningBosses = [];
  lightningEffect = null;

  // Reducir la serpiente a la mitad (mínimo 1 segmento)
  const halfLength = Math.max(1, Math.floor(snake.length / 2));
  snake = snake.slice(0, halfLength);

  coins += 50;
  saveProgress();

  setMusic("game");
}

// dt = milisegundos reales desde el frame anterior
function updateBoss(dt) {
  if (bosses.length === 0) return;
  const k = dt / BASE_TICK_MS; // "ticks equivalentes" a la velocidad original

  // Daño de veneno
  poisonedBosses = poisonedBosses.filter((p) => {
    if (gameTime > p.endTime || !bosses.includes(p.boss)) return false;
    p.timer += dt;
    while (p.timer >= POISON_TICK_MS) {
      p.timer -= POISON_TICK_MS;
      p.boss.health -= 1;
    }
    return true;
  });

  // Daño de quemadura
  burningBosses = burningBosses.filter((b) => {
    if (gameTime > b.endTime || !bosses.includes(b.boss)) return false;
    b.timer += dt;
    while (b.timer >= BURN_TICK_MS) {
      b.timer -= BURN_TICK_MS;
      b.boss.health -= 1;
    }
    return true;
  });

  checkBossDeaths();
  if (bosses.length === 0) return;

  bosses.forEach((boss) => {
    // Movimiento horizontal con rebote
    boss.x += boss.speed * boss.direction * k;
    if (boss.x <= 0) {
      boss.x = 0;
      boss.direction = 1;
    } else if (boss.x + boss.width >= baseSize) {
      boss.x = baseSize - boss.width;
      boss.direction = -1;
    }

    // Habilidades de los bosses
    boss.abilityTimer += k;
    if (boss.abilityTimer >= boss.abilityInterval && !boss.abilityActive) {
      boss.abilityTimer = 0;
      boss.abilityActive = true;

      if (boss.ability === "teleport_shield") {
        boss.abilityDuration = 90;
        boss.x = Math.random() * (baseSize - boss.width);
        boss.y = 30 + Math.random() * 50;
      } else if (boss.ability === "stalactite_rain") {
        boss.abilityDuration = 120;
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const sp = 6;
          bossProjectiles.push({
            x: boss.x + boss.width / 2,
            y: boss.y + boss.height / 2,
            vx: Math.cos(angle) * sp,
            vy: Math.sin(angle) * sp,
            size: 12,
            type: "stalactite",
            bossType: boss.type,
            rotation: 0,
          });
        }
      }
    }

    if (boss.abilityActive) {
      boss.abilityDuration -= k;
      if (boss.abilityDuration <= 0) boss.abilityActive = false;
    }

    // Disparo normal (no durante la lluvia de estalactitas)
    boss.shootTimer += k;
    if (boss.shootTimer >= boss.shootInterval && !(boss.ability === "stalactite_rain" && boss.abilityActive)) {
      boss.shootTimer = 0;

      const head = snake[0];
      const angle = Math.atan2(head.y - (boss.y + boss.height / 2), head.x - (boss.x + boss.width / 2));
      const baseSpeed = boss.projectileType === "energy" ? 8 : 7;

      if (boss.projectileType === "energy") {
        bossProjectiles.push({
          x: boss.x + boss.width / 2,
          y: boss.y + boss.height,
          vx: Math.cos(angle) * baseSpeed,
          vy: Math.sin(angle) * baseSpeed,
          size: 10,
          type: "energy",
          bossType: boss.type,
        });
      } else {
        bossProjectiles.push({
          x: boss.x + boss.width / 2,
          y: boss.y + boss.height,
          vx: Math.cos(angle) * baseSpeed * 0.8,
          vy: Math.sin(angle) * baseSpeed * 0.8,
          size: 12,
          type: "stalactite",
          bossType: boss.type,
          rotation: 0,
        });
      }
    }
  });

  // Escudo dorado: ralentiza los proyectiles
  const skin = skins[skinIndex];
  const slowFactor = abilityActive && skin.ability === "golden_shield" ? 0.25 : 1.0;

  bossProjectiles = bossProjectiles.filter((p) => {
    p.x += p.vx * slowFactor * k;
    p.y += p.vy * slowFactor * k;
    if (p.type === "stalactite") p.rotation = (p.rotation || 0) + 0.1 * k;
    return !(p.x < 0 || p.x > baseSize || p.y < 0 || p.y > baseSize);
  });
}

function checkBossCollision(head) {
  if (bosses.length === 0) return false;

  // Escudo dorado: inmune a todo
  const skin = skins[skinIndex];
  if (abilityActive && skin.ability === "golden_shield") return false;

  // Solo cuenta la colisión con la cabeza
  for (const p of bossProjectiles) {
    const dist = Math.hypot(head.x + box / 2 - p.x, head.y + box / 2 - p.y);
    if (dist < box / 2 + p.size / 2) return true;
  }
  return false;
}

// El alma con escudo activo no recibe daño del rayo
function canDamageBoss(boss) {
  return !(boss.ability === "teleport_shield" && boss.abilityActive);
}

/* ================== HABILIDADES ================== */
function useAbility() {
  const skin = skins[skinIndex];

  if (energy < skin.energyCost || skin.ability === "none" || abilityActive) return;
  if (bosses.length === 0) return; // solo hay habilidades durante peleas de boss

  energy -= skin.energyCost;

  switch (skin.ability) {
    case "lightning": {
      const target = bosses[Math.floor(Math.random() * bosses.length)];
      const blocked = !canDamageBoss(target);
      lightningEffect = {
        x: snake[0].x + box / 2,
        y: snake[0].y + box / 2,
        targetX: target.x + target.width / 2,
        targetY: target.y + target.height / 2,
        endTime: gameTime + 500,
        blocked,
      };
      if (!blocked) {
        target.health -= 3;
        checkBossDeaths();
      }
      break;
    }

    case "poison": {
      const target = bosses[Math.floor(Math.random() * bosses.length)];
      if (!poisonedBosses.some((p) => p.boss === target)) {
        poisonedBosses.push({ boss: target, endTime: gameTime + skin.duration, timer: 0 });
      }
      break;
    }

    case "golden_shield":
      abilityActive = true;
      abilityEndTime = gameTime + skin.duration;
      break;

    case "infernal_burst":
      abilityActive = true;
      abilityEndTime = gameTime + skin.duration;

      bosses.forEach((boss) => {
        if (!burningBosses.some((b) => b.boss === boss)) {
          burningBosses.push({ boss, endTime: gameTime + skin.duration, timer: 0 });
        }
      });

      // Destruir proyectiles cercanos (radio de explosión)
      bossProjectiles = bossProjectiles.filter((p) => {
        const head = snake[0];
        return Math.hypot(head.x + box / 2 - p.x, head.y + box / 2 - p.y) > 250;
      });
      break;
  }
}

function rechargeEnergy(amount) {
  energy = Math.min(maxEnergy, energy + amount);
}

function hitBoss() {
  if (bosses.length === 0) return;

  // Dañar al primer boss vivo (uno por comida)
  const target = bosses.find((b) => b.health > 0);
  if (target) target.health--;

  checkBossDeaths();
}

/* ================== RESET ================== */
function resetGame() {
  lastLevelGenerated = 1;
  snake = [{ x: Math.floor(cols / 2) * box, y: Math.floor(rows / 2) * box }];
  direction = "RIGHT";
  inputQueue = [];
  score = 0;
  level = 1;
  speed = 120;
  accumulator = 0;
  coin = null;
  bosses = [];
  bossProjectiles = [];
  obstacles = [];
  energy = 100;
  abilityActive = false;
  abilityEndTime = 0;
  poisonedBosses = [];
  burningBosses = [];
  lightningEffect = null;
  paused = false;
  gameOver = false;
  newRecord = false;
  scoreEl.textContent = score;
  levelEl.textContent = level;
  spawnFood();
  generateObstacles();
}

/* ================== UI HTML (solo se toca el DOM si algo cambió) ================== */
const abilityInfo = document.getElementById("ability-info");
const abilityNameEl = document.getElementById("ability-name");
const energyFill = document.getElementById("energy-fill");
const energyText = document.getElementById("energy-text");
const abilityBtn = document.getElementById("ability-btn");
let lastUISig = "";
let lastBtnSig = "";

function updateHTMLUI() {
  const skin = skins[skinIndex];
  let sig;
  let pct = 0;
  let state = "";
  let text = "";

  if (skin.ability === "none") {
    sig = "none";
  } else {
    pct = Math.floor((energy / maxEnergy) * 100);
    state = abilityActive ? "active" : pct <= 30 ? "low" : pct <= 60 ? "medium" : "";
    text = abilityActive
      ? `Activa: ${Math.max(0, Math.ceil((abilityEndTime - gameTime) / 1000))}s`
      : `⚡${Math.floor(energy)}/${skin.energyCost}`;
    sig = [skinIndex, pct, state, text].join("|");
  }
  if (sig === lastUISig) return;
  lastUISig = sig;

  if (skin.ability === "none") {
    abilityInfo.classList.add("hidden");
    return;
  }
  abilityInfo.classList.remove("hidden");
  abilityNameEl.textContent = skin.abilityName.toUpperCase();
  energyFill.style.width = pct + "%";
  energyFill.classList.remove("active", "medium", "low");
  if (state) energyFill.classList.add(state);
  energyText.textContent = text;
}

function updateAbilityButton() {
  const skin = skins[skinIndex];
  const disabled =
    screen !== "game" ||
    gameOver ||
    paused ||
    skin.ability === "none" ||
    energy < skin.energyCost ||
    bosses.length === 0;
  const icon = abilityActive ? "🔥" : "⚡";
  const sig = disabled + icon;
  if (sig === lastBtnSig) return;
  lastBtnSig = sig;
  abilityBtn.classList.toggle("disabled", disabled);
  abilityBtn.textContent = icon;
}

/* ================== BOTONES (zonas clicables compartidas) ================== */
const MENU_BTNS = { play: [210, 255], shop: [270, 315] };
const PAUSE_BTNS = { resume: [180, 218], restart: [233, 270], menu: [285, 323] };
const OVER_BTNS = { restart: [225, 270], menu: [285, 330] };
const shopRowY = (i) => 105 + i * 60;
const inRange = (y, [a, b]) => y > a && y < b;

/* ================== BOTÓN PAUSE HTML ================== */
const pauseBtn = document.getElementById("pause-btn");
pauseBtn.addEventListener("click", () => {
  if (screen === "game" && !gameOver && !pauseLock) {
    paused = !paused;
    pauseLock = true;
    setTimeout(() => (pauseLock = false), 200);
  }
});

/* ================== TECLADO ================== */
const KEY_DIRS = {
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
  w: "UP",
  s: "DOWN",
  a: "LEFT",
  d: "RIGHT",
};

document.addEventListener("keydown", (e) => {
  if (screen !== "game") return;

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (key === "p") {
    if (!gameOver) paused = !paused;
    return;
  }

  if (key === " " || key === "Spacebar") {
    e.preventDefault();
    if (!paused && !gameOver) useAbility();
    return;
  }

  const dir = KEY_DIRS[key];
  if (dir) {
    e.preventDefault();
    queueDirection(dir);
  }
});

function queueDirection(dir) {
  if (screen !== "game" || paused || gameOver) return;
  const last = inputQueue.length ? inputQueue[inputQueue.length - 1] : direction;
  if (dir === last || dir === OPPOSITE[last]) return;
  if (inputQueue.length < 2) inputQueue.push(dir);
}

/* ================== INPUT CANVAS (POINTER + SWIPE) ================== */
let swipeStart = null;
const SWIPE_MIN_PX = 24;

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const scaleX = baseSize / rect.width;
  const scaleY = baseSize / rect.height;
  handleInput((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);

  if (screen === "game" && !paused && !gameOver) {
    swipeStart = { x: e.clientX, y: e.clientY };
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!swipeStart || screen !== "game" || paused || gameOver) return;
  const dx = e.clientX - swipeStart.x;
  const dy = e.clientY - swipeStart.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;

  queueDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "RIGHT" : "LEFT") : dy > 0 ? "DOWN" : "UP");
  swipeStart = { x: e.clientX, y: e.clientY };
});

const endSwipe = () => (swipeStart = null);
canvas.addEventListener("pointerup", endSwipe);
canvas.addEventListener("pointercancel", endSwipe);
canvas.addEventListener("pointerleave", endSwipe);

/* ================== INPUT UI ================== */
function startPlaying() {
  resetGame();
  screen = "game";
  setMusic("game");
}

function goToMenu() {
  screen = "menu";
  paused = false;
  setMusic("menu");
}

function handleInput(x, y) {
  /* MENÚ PAUSA */
  if (screen === "game" && paused && !gameOver) {
    if (inRange(y, PAUSE_BTNS.resume)) {
      paused = false;
      return;
    }
    if (inRange(y, PAUSE_BTNS.restart)) {
      resetGame();
      setMusic("game");
      return;
    }
    if (inRange(y, PAUSE_BTNS.menu)) {
      goToMenu();
      return;
    }
  }

  /* MENÚ */
  if (screen === "menu") {
    if (inRange(y, MENU_BTNS.play)) startPlaying();
    else if (inRange(y, MENU_BTNS.shop)) screen = "shop";
    return;
  }

  /* SHOP */
  if (screen === "shop") {
    skins.forEach((s, i) => {
      const sy = shopRowY(i);
      if (x > 120 && x < 330 && y > sy && y < sy + 45) {
        if (!unlockedSkins[i] && coins >= s.price) {
          coins -= s.price;
          unlockedSkins[i] = true;
        }
        if (unlockedSkins[i]) skinIndex = i;
        saveProgress();
      }
    });
    if (y > 390) screen = "menu";
    return;
  }

  /* GAME OVER */
  if (gameOver) {
    if (inRange(y, OVER_BTNS.restart)) {
      resetGame();
      setMusic("game");
    } else if (inRange(y, OVER_BTNS.menu)) {
      goToMenu();
    }
  }
}

/* ================== DIBUJO ================== */
function drawBG() {
  if (bgImage.ok) {
    ctx.drawImage(bgImage.img, 0, 0, baseSize, baseSize);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, baseSize);
    g.addColorStop(0, "#220000");
    g.addColorStop(1, "#000");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, baseSize, baseSize);
  }
}

function drawFood() {
  ctx.save();
  ctx.font = "20px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "#ff0000";
  setGlow(20);
  ctx.fillText("💀", food.x + box / 2, food.y + box / 2);
  ctx.restore();
}

function drawCoin() {
  if (!coin || !soul.ok) return;

  const w = box * COIN_SCALE;
  const h = box * COIN_SCALE;

  ctx.save();
  ctx.shadowColor = "#00ffff";
  setGlow(20);
  ctx.drawImage(soul.img, coin.x - (w - box) / 2, coin.y - (h - box) / 2, w, h);
  ctx.restore();
}

function drawSnake() {
  const skin = skins[skinIndex];

  const headScale = 2.0;
  const bodyScale = 1.6;
  const spacing = 0.7;

  for (let i = 0; i < snake.length; i++) {
    const p = snake[i];

    ctx.save();
    ctx.shadowColor = "transparent";
    setGlow(0);

    if (abilityActive) {
      if (skin.ability === "golden_shield") {
        ctx.shadowColor = "#FFD700";
        setGlow(35);
        ctx.globalAlpha = 0.95;

        if (i === 0) {
          ctx.strokeStyle = "rgba(255, 215, 0, 0.6)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(p.x + box / 2, p.y + box / 2, box * 1.8, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (skin.ability === "infernal_burst") {
        ctx.shadowColor = "#ff4400";
        setGlow(40);

        if (i === 0) {
          ctx.fillStyle = "rgba(255, 68, 0, 0.4)";
          for (let j = 0; j < 6; j++) {
            const a = ((Date.now() / 100 + j) * Math.PI) / 3;
            const fx = p.x + box / 2 + Math.cos(a) * box * 1.5;
            const fy = p.y + box / 2 + Math.sin(a) * box * 1.5;
            ctx.beginPath();
            ctx.arc(fx, fy, 8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    } else if (skin.infernal) {
      ctx.shadowColor = skin.glow;
      setGlow(20);
    }

    let angle = 0;
    if (i === 0) {
      if (direction === "UP") angle = -Math.PI / 2;
      if (direction === "DOWN") angle = Math.PI / 2;
      if (direction === "LEFT") angle = Math.PI;
      if (direction === "RIGHT") angle = 0;
    } else {
      const prev = snake[i - 1];
      if (p.x < prev.x) angle = Math.PI;
      if (p.x > prev.x) angle = 0;
      if (p.y < prev.y) angle = -Math.PI / 2;
      if (p.y > prev.y) angle = Math.PI / 2;
    }

    ctx.translate(p.x + box / 2, p.y + box / 2);
    ctx.rotate(angle);

    if (i === 0 && snakeHeads[skinIndex].ok) {
      const w = box * headScale;
      ctx.drawImage(snakeHeads[skinIndex].img, -w / 2, -w / 2, w, w);
    } else if (i !== 0 && snakeBodies[skinIndex].ok) {
      const w = box * bodyScale;
      ctx.drawImage(snakeBodies[skinIndex].img, -w / 2, -w / 2, w, w);
    } else {
      const size = box * (i === 0 ? headScale : bodyScale) * spacing;
      ctx.fillStyle = i === 0 ? skin.head : skin.body;
      ctx.fillRect(-size / 2, -size / 2, size, size);
    }

    ctx.restore();
  }
}

function drawObstacles() {
  obstacles.forEach((o) => {
    ctx.save();
    ctx.shadowColor = "#79551f";
    setGlow(15);

    if (stalactite.ok) {
      const w = box * OBSTACLE_SCALE;
      ctx.drawImage(stalactite.img, o.x + (box - w) / 2, o.y + (box - w) / 2, w, w);
    } else {
      ctx.fillStyle = "#cc1f1f";
      ctx.fillRect(o.x, o.y, box, box);
    }

    ctx.restore();
  });
}

function drawBoss() {
  if (bosses.length === 0) return;

  // Rayo
  if (lightningEffect) {
    ctx.save();
    const color = lightningEffect.blocked ? "#ff0000" : "#00ffff";
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.lineWidth = 4;
    setGlow(20);

    ctx.beginPath();
    ctx.moveTo(lightningEffect.x, lightningEffect.y);
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      ctx.lineTo(
        lightningEffect.x + (lightningEffect.targetX - lightningEffect.x) * t + (Math.random() - 0.5) * 30,
        lightningEffect.y + (lightningEffect.targetY - lightningEffect.y) * t + (Math.random() - 0.5) * 30,
      );
    }
    ctx.lineTo(lightningEffect.targetX, lightningEffect.targetY);
    ctx.stroke();

    if (lightningEffect.blocked) {
      ctx.fillStyle = "#ff0000";
      ctx.font = "bold 14px Arial";
      ctx.textAlign = "center";
      ctx.fillText("BLOQUEADO!", lightningEffect.targetX, lightningEffect.targetY - 30);
    }
    ctx.restore();
  }

  bosses.forEach((boss) => {
    ctx.save();

    const isPoisoned = poisonedBosses.some((p) => p.boss === boss);
    const isBurning = burningBosses.some((b) => b.boss === boss);
    const hasShield = boss.abilityActive && boss.ability === "teleport_shield";

    if (isBurning) {
      ctx.shadowColor = "#ff4400";
      setGlow(45);
    } else if (isPoisoned) {
      ctx.shadowColor = "#9C27B0";
      setGlow(40);
    } else if (hasShield) {
      ctx.shadowColor = "#00ffff";
      setGlow(50);
    } else if (boss.type === "soul") {
      ctx.shadowColor = "#00ffff";
      setGlow(35);
    } else {
      ctx.shadowColor = "#ff0000";
      setGlow(30);
    }

    if (hasShield) {
      ctx.strokeStyle = "rgba(0, 255, 255, 0.6)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(boss.x + boss.width / 2, boss.y + boss.height / 2, boss.width / 2 + 15, 0, Math.PI * 2);
      ctx.stroke();

      const pulse = Math.sin(Date.now() / 100) * 5;
      ctx.beginPath();
      ctx.arc(boss.x + boss.width / 2, boss.y + boss.height / 2, boss.width / 2 + 20 + pulse, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (boss.type === "soul" && soul.ok) {
      ctx.drawImage(soul.img, boss.x, boss.y, boss.width, boss.height);
    } else if (boss.type === "skull" && bossSkull && bossSkull.ok) {
      ctx.drawImage(bossSkull.img, boss.x, boss.y, boss.width, boss.height);
    } else {
      ctx.font = boss.type === "soul" ? "80px Arial" : "60px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(boss.type === "soul" ? "👻" : "💀", boss.x + boss.width / 2, boss.y + boss.height / 2);
    }

    if (isPoisoned) {
      ctx.fillStyle = "rgba(156, 39, 176, 0.4)";
      for (let i = 0; i < 3; i++) {
        const bx = boss.x + boss.width / 2 + Math.sin(Date.now() / 200 + i) * 20;
        const by = boss.y + boss.height / 2 + Math.cos(Date.now() / 200 + i) * 20;
        ctx.beginPath();
        ctx.arc(bx, by, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (isBurning) {
      ctx.fillStyle = "rgba(255, 68, 0, 0.6)";
      for (let i = 0; i < 5; i++) {
        const fx = boss.x + boss.width / 2 + (Math.random() - 0.5) * boss.width;
        const fy = boss.y + boss.height + Math.sin(Date.now() / 100 + i) * 10;
        ctx.beginPath();
        ctx.arc(fx, fy, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // Barra de vida (nunca negativa)
    const barWidth = 120;
    const barHeight = 8;
    const barX = boss.x + boss.width / 2 - barWidth / 2;
    const barY = boss.y - 15;

    ctx.fillStyle = "#333";
    ctx.fillRect(barX, barY, barWidth, barHeight);

    const healthPercent = Math.max(0, boss.health) / boss.maxHealth;
    let barColor;
    if (hasShield) barColor = "#00ffff";
    else if (isBurning) barColor = "#ff4400";
    else if (isPoisoned) barColor = "#9C27B0";
    else if (boss.type === "soul") barColor = healthPercent > 0.5 ? "#00ffff" : healthPercent > 0.25 ? "#0099ff" : "#0066ff";
    else barColor = healthPercent > 0.5 ? "#4CAF50" : healthPercent > 0.25 ? "#FFA500" : "#ff0000";

    ctx.fillStyle = barColor;
    ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
  });

  // Título de batalla
  ctx.fillStyle = "#fff";
  ctx.font = "16px Arial";
  ctx.textAlign = "center";
  ctx.shadowColor = "transparent";
  setGlow(0);

  const skullCount = bosses.filter((b) => b.type === "skull").length;
  const soulCount = bosses.filter((b) => b.type === "soul").length;
  let battleText = "BOSS BATTLE!";
  if (bosses.length === 2) {
    if (skullCount === 2) battleText = "¡CALAVERAS GEMELAS!";
    else if (soulCount === 2) battleText = "¡ALMAS GEMELAS!";
    else battleText = "¡BATALLA MIXTA!";
  }
  ctx.fillText(battleText, baseSize / 2, 15);

  // Proyectiles
  ctx.save();
  bossProjectiles.forEach((p) => {
    if (p.type === "energy") {
      ctx.shadowColor = "#00ffff";
      setGlow(20);
      ctx.fillStyle = "#00ccff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === "stalactite") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation || 0);
      ctx.shadowColor = "#79551f";
      setGlow(15);

      if (stalactite.ok) {
        const w = p.size * 2.5;
        ctx.drawImage(stalactite.img, -w / 2, -w / 2, w, w);
      } else {
        ctx.fillStyle = "#8B4513";
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size / 2, p.size);
        ctx.lineTo(-p.size / 2, p.size);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  });
  ctx.restore();
}

/* ================== GAME ================== */
function triggerGameOver() {
  setMusic(null);
  play(hitSound);

  // Pequeño delay para que se escuche el golpe antes del game over
  setTimeout(() => {
    if (gameOver) play(gameOverSound);
  }, 200);

  gameOver = true;
  coins += score;
  if (score > highScore) {
    highScore = score;
    newRecord = true;
  }
  saveProgress();
}

// Un paso de la serpiente (una celda)
function stepSnake() {
  if (inputQueue.length) direction = inputQueue.shift();

  const h = { ...snake[0] };
  if (direction === "UP") h.y -= box;
  if (direction === "DOWN") h.y += box;
  if (direction === "LEFT") h.x -= box;
  if (direction === "RIGHT") h.x += box;

  const hitWall = h.x < 0 || h.y < 0 || h.x >= baseSize || h.y >= baseSize;
  const hitSelf = snake.some((p) => same(p, h));
  const hitObstacle = obstacles.some((o) => same(o, h));
  const hitBossProjectile = bosses.length > 0 && checkBossCollision(h);

  if (hitWall || hitSelf || hitObstacle || hitBossProjectile) {
    triggerGameOver();
    return;
  }

  snake.unshift(h);

  if (same(h, food)) {
    score++;
    scoreEl.textContent = score;

    rechargeEnergy(bosses.length > 0 ? 15 : 10);

    // En pelea de boss la serpiente no crece y la comida daña al boss
    if (bosses.length > 0) {
      snake.pop();
      hitBoss();
    }

    play(eatSound);
    spawnFood();

    // Subir de nivel cada 5 puntos (solo si no hay boss activo)
    if (score % 5 === 0 && level === lastLevelGenerated && bosses.length === 0) {
      level++;
      lastLevelGenerated = level;
      levelEl.textContent = level;

      if (level <= 7) speed = Math.max(40, speed - 8);

      if (level % 5 === 0 && bosses.length === 0) {
        createBoss(level);
      } else if (level % 2 === 0 && level % 5 !== 0) {
        // Alma en niveles pares que no sean múltiplos de 5
        let tries = 0;
        do {
          coin = randPos();
          tries++;
        } while (
          tries < 500 &&
          (snake.some((s) => same(s, coin)) || obstacles.some((o) => same(o, coin)) || same(food, coin))
        );
      }

      if (bosses.length === 0) generateObstacles();
    }
  } else {
    snake.pop();
  }

  // Alma: se recoge también en las celdas contiguas (el sprite es más grande que la celda)
  if (coin && Math.abs(h.x - coin.x) <= box && Math.abs(h.y - coin.y) <= box) {
    coins++;
    coin = null;
    saveProgress();
    play(soulSound);
  }
}

function expireTimedEffects() {
  if (abilityActive && gameTime >= abilityEndTime) abilityActive = false;
  if (lightningEffect && gameTime >= lightningEffect.endTime) lightningEffect = null;
}

/* ================== RENDER ================== */
function render() {
  ctx.shadowColor = "transparent";
  setGlow(0);
  ctx.textAlign = "center";

  drawBG();
  drawObstacles();

  if (screen === "menu") {
    ctx.fillStyle = "#f5f5f5";
    ctx.font = "30px Arial";
    ctx.fillText("SNAKE INFERNAL", baseSize / 2, 90);
    ctx.font = "16px Arial";
    ctx.fillText(`BEST: ${highScore}`, baseSize / 2, 130);
    ctx.font = "24px Arial";
    ctx.fillText("PLAY", baseSize / 2, 225);
    ctx.fillText("SHOP", baseSize / 2, 285);
    if (soul.ok) ctx.drawImage(soul.img, baseSize / 2 - 45, 318, 60, 60);
    ctx.fillText(`${coins}`, baseSize / 2 + 25, 342);
    return;
  }

  if (screen === "shop") {
    ctx.fillStyle = "#f5f5f5";
    ctx.font = "24px Arial";
    ctx.fillText("SKINS", baseSize / 2, 60);
    skins.forEach((s, i) => {
      const y = shopRowY(i);
      ctx.fillStyle = unlockedSkins[i] ? s.head : "#333";
      ctx.fillRect(120, y, 210, 45);
      ctx.fillStyle = "#f5f5f5";
      ctx.font = "18px Arial";
      ctx.fillText(s.name, 165, y + 15);

      if (s.ability !== "none") {
        ctx.font = "11px Arial";
        ctx.fillStyle = "#aaffaa";
        ctx.fillText(s.abilityDesc || s.abilityName, 165, y + 32);
      }

      if (soul.ok) ctx.drawImage(soul.img, 240, y + 9, 21, 21);

      ctx.font = "18px Arial";
      ctx.fillStyle = "#f5f5f5";
      ctx.fillText(s.price, 270, y + 25);
    });
    ctx.fillStyle = "#aaa";
    ctx.font = "24px Arial";
    ctx.fillText("BACK", baseSize / 2, 420);
    return;
  }

  drawFood();
  drawCoin();
  drawSnake();
  drawBoss();

  ctx.shadowColor = "transparent";
  setGlow(0);

  updateHTMLUI();
  updateAbilityButton();

  if (paused && !gameOver) {
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(0, 0, baseSize, baseSize);
    ctx.fillStyle = "#f31414";
    ctx.font = "28px Arial";
    ctx.fillText("PAUSED", baseSize / 2, 135);
    ctx.font = "24px Arial";
    ctx.fillText("RESUME", baseSize / 2, 203);
    ctx.fillText("RESTART", baseSize / 2, 255);
    ctx.fillText("MENU", baseSize / 2, 308);
  }

  if (gameOver) {
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillRect(0, 0, baseSize, baseSize);
    ctx.fillStyle = "#f5f5f5";
    ctx.font = "32px Arial";
    ctx.fillText("GAME OVER", baseSize / 2, 170);
    ctx.font = "18px Arial";
    ctx.fillStyle = newRecord ? "#FFD700" : "#f5f5f5";
    ctx.fillText(newRecord ? `¡NUEVO RÉCORD! ${score}` : `SCORE ${score}  ·  BEST ${highScore}`, baseSize / 2, 205);
    ctx.fillStyle = "#f5f5f5";
    ctx.font = "24px Arial";
    ctx.fillText("RESTART", baseSize / 2, 250);
    ctx.fillText("MENU", baseSize / 2, 310);
  }
}

/* ================== CONTROLES TÁCTILES ================== */
document.querySelectorAll(".controls button[data-dir]").forEach((btn) => {
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    queueDirection(btn.dataset.dir);
  });
});

abilityBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (screen === "game" && !gameOver && !paused) useAbility();
});

/* ================== LOOP ================== */
function frame(t) {
  const dt = Math.min(t - lastFrame, 100); // tope para no "saltar" al volver de una pestaña inactiva
  lastFrame = t;

  if (screen === "game" && !paused && !gameOver) {
    gameTime += dt;
    expireTimedEffects();
    updateBoss(dt);

    // Paso fijo de la serpiente, independiente de la tasa de refresco de la pantalla
    accumulator += dt;
    let steps = 0;
    while (accumulator >= speed && steps < 3 && !gameOver) {
      stepSnake();
      accumulator -= speed;
      steps++;
    }
    if (steps === 3) accumulator = 0;
  }

  render();
  requestAnimationFrame(frame);
}

/* ================== VISIBILIDAD, SILENCIO E INSTALACIÓN ================== */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (screen === "game" && !gameOver) paused = true;
    if (currentTrack) tracks[currentTrack].pause();
  } else if (currentTrack) {
    tracks[currentTrack].play().catch(() => {});
  }
});

const muteBtn = document.getElementById("mute-btn");
if (muteBtn) {
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    storageSet("muted", muted ? "1" : "0");
    applyMute();
  });
}

const installBtn = document.getElementById("install-btn");
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (installBtn) installBtn.hidden = false;
});
if (installBtn) {
  installBtn.addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    try {
      await deferredInstall.userChoice;
    } catch (e) {
      /* el usuario cerró el diálogo */
    }
    deferredInstall = null;
    installBtn.hidden = true;
  });
}
window.addEventListener("appinstalled", () => {
  deferredInstall = null;
  if (installBtn) installBtn.hidden = true;
});

/* ================== INICIO ================== */
applyMute();
setMusic("menu"); // si el navegador lo bloquea, arranca en la primera interacción
requestAnimationFrame(frame);
