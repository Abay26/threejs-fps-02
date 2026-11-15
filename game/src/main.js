// Meridian Yard: a round-based tactical FPS in three.js. Boot and the one loop: a fixed
// 60 Hz simulation feeding a render at the display's rate. ?shot=start|play|buy|end with
// &seed=N sets up a deterministic frame for a capture, renders it twice, then freezes it
// and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapon.js';
import { createBots } from './bots.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createMatch, BUY_SECONDS, PLANT_SECONDS, DEFUSE_SECONDS } from './rounds.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);
const originalRandom = Math.random;
Math.random = random;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 40, 110);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const audio = createAudio();
const hud = createHud();
const world = createWorld(scene);
const player = createPlayer(world.colliders, SPAWNS.vanguard[0]);
const weapon = createWeapon(camera, audio);
const input = createInput(renderer.domElement, onLockChange);

const body = player.state;
const playerView = { position: body.position, alive: true, moving: false };
let playerDead = false;
let channel = 0; // plant/defuse progress, seconds held
let channelKind = null;
let buyOpen = false;
let muted = false;

const match = createMatch({
  hud, audio,
  onRoundEnd() {
    bots.setFrozen(true);
    hud.hideBuy();
    buyOpen = false;
  },
  onRoundLive() { hud.hideBuy(); buyOpen = false; },
  onNextRound() { resetRoundPositions(); },
  onMatchEnd(won) {
    bots.setFrozen(true);
    if (document.pointerLockElement) document.exitPointerLock();
    hud.showOverlay('match', {
      title: won ? 'MATCH WON' : 'MATCH LOST',
      copy: won
        ? `Vanguard takes Meridian Yard ${match.state.scoreV}–${match.state.scoreS}. The yard is yours.`
        : `Sentinel holds Meridian Yard ${match.state.scoreS}–${match.state.scoreV}. Run it back.`,
    });
  },
  onSpikePlanted() { /* banner already shown by the match */ },
});

const bots = createBots(scene, world, {
  audio,
  fireTracer: (from, to, colour) => weapon.fireVisual(from, to, colour),
  onKill(killer, victim, headshot) {
    hud.killfeed(killer, victim, headshot);
    if (killer === 'You') {
      match.addKillReward();
      audio.kill();
    }
  },
  onPlayerDamaged(amount) {
    if (playerDead) return;
    player.damage(amount);
    hud.setHealth(body.health, body.armor);
    hud.damageFlash();
    if (body.health <= 0) {
      playerDead = true;
      playerView.alive = false;
      match.dropSpike(body.position);
      hud.banner('YOU ARE DOWN', 'Your team fights on — next round you respawn', false);
      checkRoundEnd();
    }
  },
  onSpikePlanted(site, position) {
    match.plantSpike(site, position);
  },
  onSpikeDefused() {
    match.defuseSpike();
  },
});

const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const aimDirection = new THREE.Vector3();

function botHitMeshes() {
  const meshes = [];
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    bot.body.group.traverse((mesh) => {
      if (mesh.isMesh) meshes.push(mesh);
    });
  }
  return meshes;
}

function shoot(spread) {
  const def = weapon.def();
  if (!weapon.takeRound()) {
    audio.dryFire();
    weapon.reload();
    return;
  }
  camera.getWorldDirection(aimDirection);
  aimDirection.x += (random() * 2 - 1) * spread;
  aimDirection.y += (random() * 2 - 1) * spread;
  aimDirection.z += (random() * 2 - 1) * spread;
  aimDirection.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, aimDirection);
  const hits = raycaster.intersectObjects(world.shootables.concat(botHitMeshes()), false);
  const hit = hits[0];
  const end = hit ? hit.point.clone() : camera.position.clone().addScaledVector(aimDirection, def.range);
  weapon.fireVisual(camera.position.clone().addScaledVector(aimDirection, 0.6), end, def.tracer);
  audio.shot(weapon.state.id);
  if (hit && hit.object.userData.botRef) {
    const bot = hit.object.userData.botRef;
    const headshot = hit.object.userData.isHead === true;
    const damage = headshot ? def.headDamage : def.damage;
    hud.hitMarker(false);
    bots.damageBot(bot, damage, { name: 'You' }, headshot);
  } else if (hit) {
    hud.hitMarker(false);
  }
  player.recoil(0.011 + random() * 0.005, (random() * 2 - 1) * 0.005);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, def.name);
}

function checkRoundEnd() {
  const counts = bots.aliveCounts();
  const vAlive = counts.vanguard + (playerView.alive ? 1 : 0);
  const sAlive = counts.sentinel;
  if (match.state.phase !== 'live') return;
  if (match.state.spike.status === 'planted') return; // spike decides it now
  if (sAlive === 0) match.endRound('vanguard', 'elimination');
  else if (vAlive === 0) match.endRound('sentinel', 'elimination');
}

function resetRoundPositions() {
  playerDead = false;
  playerView.alive = true;
  // Spawn facing north (yaw 0), down the yard toward Mid and the sites.
  player.reset(SPAWNS.vanguard[0], 0);
  weapon.refill();
  bots.setFrozen(false);
  bots.spawnRound(random);
  // Attach each bot's meshes back to its bot record for hit detection.
  for (const bot of bots.bots) {
    bot.body.group.traverse((mesh) => { mesh.userData.botRef = bot; });
  }
  hud.setHealth(100, body.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  hud.setPlant(null);
  hud.setSpike(null);
  updateAliveHud();
}

function updateAliveHud() {
  const counts = bots.aliveCounts();
  hud.setAlive(counts.vanguard + (playerView.alive ? 1 : 0), counts.sentinel);
  hud.drawMinimap(world.colliders, body, bots.bots, match.state.spike.status === 'planted' || match.state.spike.status === 'dropped' ? match.state.spike.position : null);
}

function openBuy() {
  if (match.state.phase !== 'buy') return;
  buyOpen = true;
  // Free the mouse so the shop's rows are clickable; number keys work either way.
  if (document.pointerLockElement) document.exitPointerLock();
  const items = Object.entries(WEAPONS).map(([id, w], i) => ({
    id, key: String(i + 1), name: `${w.name} · ${w.kind}`, price: w.price,
    desc: `${w.damage} dmg · ${w.mag} rounds · ${w.rate * 1000 | 0}ms`,
    buy: () => buyWeapon(id),
  }));
  items.push({
    id: 'armor', key: '5', name: 'Kevlar Vest', price: 650,
    desc: 'Soaks 60% of damage until depleted',
    buy: () => {
      if (match.buyArmor(650)) {
        body.armor = 100;
        hud.setHealth(body.health, body.armor);
        openBuy();
      }
    },
  });
  hud.showBuy(match.state.money, items, new Set([weapon.state.id]));
}

function buyWeapon(id) {
  const w = WEAPONS[id];
  if (!match.buyWeapon(id, w.price)) return;
  weapon.equip(id);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, w.name);
  openBuy();
}

function handleKeys() {
  const keys = input.state.keys;
  const pressedSet = input.takePressed();
  const pressed = (code) => pressedSet.has(code);
  if (pressed('KeyB')) {
    if (buyOpen) {
      hud.hideBuy();
      buyOpen = false;
      input.requestLock();
    } else openBuy();
  }
  if (buyOpen) {
    const ids = Object.keys(WEAPONS);
    ids.forEach((id, i) => {
      if (pressed(`Digit${i + 1}`)) buyWeapon(id);
    });
    if (pressed('Digit5') && match.buyArmor(650)) {
      body.armor = 100;
      hud.setHealth(body.health, body.armor);
      openBuy();
    }
  }
  if (pressed('KeyM')) {
    muted = !muted;
    audio.setEnabled(!muted);
  }
}

function plantDefuseStep(dt) {
  const spike = match.state.spike;
  const inSite = (site) => body.position.distanceTo(new THREE.Vector3(site.center.x, 0, site.center.z)) < site.radius;
  let kind = null;
  let progress = 0;
  if (match.state.phase === 'live' && !playerDead && input.state.keys.has('KeyE')) {
    if (spike.status === 'carried' && spike.carrier === 'player' && (inSite(SITES.A) || inSite(SITES.B))) {
      kind = 'plant';
      channel += dt;
      progress = channel / PLANT_SECONDS;
      if (channel >= PLANT_SECONDS) {
        const site = inSite(SITES.A) ? 'A' : 'B';
        channel = 0;
        match.plantSpike(site, body.position.clone());
      }
    } else if (spike.status === 'planted' && body.position.distanceTo(spike.position) < 2) {
      kind = 'defuse';
      channel += dt;
      progress = channel / DEFUSE_SECONDS;
      if (channel >= DEFUSE_SECONDS) {
        channel = 0;
        match.defuseSpike();
      }
    }
  }
  if (kind === null) channel = 0;
  if (kind !== channelKind) channelKind = kind;
  hud.setPlant(kind === 'plant' ? 'PLANTING SPIKE — hold E' : kind === 'defuse' ? 'DEFUSING — hold E' : null, progress);
}

function onLockChange(locked) {
  if (shot) return;
  audio.unlock();
  if (locked) {
    hud.hideOverlay();
    hud.hideBuy();
    buyOpen = false;
  } else if (match.state.phase !== 'match' && !buyOpen) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (match.state.phase === 'match') {
    match.startMatch();
    resetRoundPositions();
  }
  input.requestLock();
});

let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let frozen = false;
let minimapTimer = 0;

function step(dt) {
  elapsed += dt;
  handleKeys();
  if (!playerDead) player.step(dt, input.state.keys);
  playerView.moving = player.groundSpeed() > 0.5;
  weapon.step(dt, player.groundSpeed());
  bots.step(dt, playerView, match.state.spike, match.state.phase === 'live');
  match.step(dt);
  plantDefuseStep(dt);
  checkRoundEnd();
  minimapTimer -= dt;
  if (minimapTimer <= 0) {
    minimapTimer = 0.25;
    updateAliveHud();
  }
  hud.setCrosshairSpread(4 + player.groundSpeed() * 1.2 + weapon.state.kick * 10);
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(player.cameraPitch(), player.cameraYaw(), 0, 'YXZ');
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    if (input.state.firing && weapon.ready() && !playerDead && match.state.phase === 'live') {
      shoot(weapon.spread(player.groundSpeed()));
    }
    if (input.state.keys.has('KeyR')) weapon.reload();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  hud.hideBanner();
  match.startMatch();
  hud.hideBanner();
  resetRoundPositions();
  bots.setFrozen(true);
  if (name === 'start') {
    body.position.set(0, 0, 16);
    body.yaw = 0.15;
    body.pitch = 0.02;
    settle(10);
    hud.showOverlay('start');
    hud.setTimer(BUY_SECONDS);
  } else if (name === 'buy') {
    body.position.set(-2, 0, 17);
    aimAt(new THREE.Vector3(-6, 1.4, 4));
    settle(10);
    match.state.money = 4150;
    hud.setMoney(4150);
    openBuy();
  } else if (name === 'play') {
    match.state.phase = 'live';
    match.state.timeLeft = 84;
    match.state.scoreV = 2;
    match.state.scoreS = 1;
    hud.setScore(2, 1);
    hud.setTimer(84);
    weapon.equip('falcon');
    body.position.set(6, 0, 6);
    const target = bots.bots.find((b) => b.team === 'sentinel' && b.alive);
    if (target) {
      target.position.set(8, 0, -1);
      target.body.group.position.copy(target.position);
      target.body.group.rotation.y = Math.PI;
      const second = bots.bots.find((b) => b.team === 'sentinel' && b.alive && b !== target);
      if (second) {
        second.position.set(12, 0, -4);
        second.body.group.position.copy(second.position);
        second.body.group.rotation.y = Math.PI / 2;
      }
      aimAt(new THREE.Vector3(8, 1.35, -1));
      settle(6);
      shoot(0);
      settle(2);
    }
    hud.killfeed('Rook', 'Warden', false);
    hud.killfeed('You', 'Kite', true);
    updateAliveHud();
  } else if (name === 'end') {
    match.state.phase = 'ended';
    match.state.scoreV = 3;
    match.state.scoreS = 2;
    hud.setScore(3, 2);
    match.plantSpike('A', new THREE.Vector3(-24, 0, -13));
    match.state.spike.timer = 12.4;
    hud.setSpike(12.4);
    body.position.set(-14, 0, -4);
    aimAt(new THREE.Vector3(-24, 1.2, -13));
    settle(10);
    hud.banner('ROUND WON', 'Round 5 · Spike detonated at Site A', true);
    updateAliveHud();
  }
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  hud.setHealth(body.health, body.armor);
  paintTwiceThenReady();
}

// A small read-only handle for automated play-tests (and for players who want to
// script the game): the match phase, the bots and the player's own state.
window.__meridian = {
  get phase() { return match.state.phase; },
  get round() { return match.state.round; },
  get score() { return [match.state.scoreV, match.state.scoreS]; },
  get money() { return match.state.money; },
  get spike() { return match.state.spike.status; },
  get player() {
    return {
      x: +body.position.x.toFixed(2), z: +body.position.z.toFixed(2),
      hp: Math.ceil(body.health), armor: Math.ceil(body.armor),
      weapon: weapon.state.id, mag: weapon.state.mag,
    };
  },
  get bots() {
    return bots.bots.map((b) => ({
      name: b.name, team: b.team, alive: b.alive, hp: Math.ceil(b.health),
      x: +b.position.x.toFixed(1), z: +b.position.z.toFixed(1),
    }));
  },
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

Math.random = originalRandom;
match.startMatch();
resetRoundPositions();
hud.setHealth(100, 0);
hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
hud.setMoney(800);
hud.showOverlay('start');
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
