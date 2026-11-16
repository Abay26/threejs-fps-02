// Saltline Terminal v4: a round-based tactical FPS in three.js. Boot and the one loop:
// a fixed 60 Hz simulation feeding a render at the display's rate. ?shot=start|play|
// buy|end with &seed=N sets up a deterministic frame for a capture, renders it twice,
// then freezes it and sets window.__shotReady.
//
// What v4 adds over v3: the round is played as a team all the way through. A bot
// that wedges on a container face sidesteps free and re-plans instead of standing
// there until the fuse runs out (the v3 retake bug); once the spike is down the
// attackers spread to post-plant off-angles while the retake splits into one
// defuser and covers holding the hall approaches; two deaths on the push rotate
// the whole attack to the other site; a save round is a team decision from the
// average wallet, not five solo buys; a site-holder's hit call rotates the mid
// rover to reinforce; duels are fought planted at range and strafing up close,
// with burst discipline by distance and a role aim skill; and the last bot alive
// plays a clutch — faster reactions, straight for the defuse. The carrier plants
// the moment he is inside the site instead of duelling on it, pushes instead of
// taking long duels, and the spike's recovery names the site the whole team plays
// for; the entry flash goes off at the site door, not from spawn, and a B rush
// pushes as one pack with two flashes.
//
// The simulation is one state store: the match (rounds, money, spike), the player,
// the bots, the grenades and the senses all read and write the same objects, and the
// hot loops reuse module-level scratch vectors instead of allocating every frame.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { createSenses } from './senses.js';
import { createGrenades } from './grenades.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapon.js';
import { createBots } from './bots.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createMatch, BUY_SECONDS, PLANT_SECONDS, DEFUSE_SECONDS, FLASH_PRICE, SMOKE_PRICE } from './rounds.js';
import { planRound, CALLOUTS } from './strat.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
// A capture URL pins the seed (?shot=…&seed=1); a normal game seeds from the
// clock, so no two matches play the same strat order.
const seedParam = params.get('seed');
const seed = seedParam ? (Number.parseInt(seedParam, 10) || 1) : ((Date.now() % 2147483647) || 1);

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
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 45, 130);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
scene.add(camera);

// Scratch vectors: the hot loops (shooting, sight, movement) reuse these and never
// allocate a vector per frame.
const aimDir = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();
const endPos = new THREE.Vector3();
const tempVec = new THREE.Vector3();
const tempVec2 = new THREE.Vector3();

const audio = createAudio();
const hud = createHud();
const world = createWorld(scene);
const senses = createSenses(world);
const player = createPlayer(world.colliders, SPAWNS.vanguard[0]);
const weapon = createWeapon(camera, audio);
const input = createInput(renderer.domElement, onLockChange);

const body = player.state;
const playerView = { position: body.position, alive: true, moving: false, crouched: false };
let playerDead = false;
let channel = 0; // plant/defuse progress, seconds held
let channelKind = null;
let buyOpen = false;
let muted = false;
let clutchShown = false;
let currentPlan = null;
const loadout = { flash: 1, smoke: 1, selected: 'flash', hasKit: false };

const grenades = createGrenades(scene, world, {
  onFlash(position) {
    audio.flash();
    // Bots that can see the burst are blinded; the player is flashed if they
    // are looking at it with a line of sight.
    bots.blindBotsAt(position, 26);
    if (!playerDead) {
      tempVec.copy(position).sub(camera.position);
      const dist = tempVec.length();
      if (dist < 30) {
        camera.getWorldDirection(tempVec2);
        const facing = tempVec2.dot(tempVec.normalize());
        if (facing > 0.35 && senses.hasLOS(camera.position, position, [])) {
          hud.flashBang(Math.max(0.35, 1 - dist / 30) * (0.5 + facing * 0.5));
        }
      }
    }
  },
  onSmoke(position) {
    audio.smoke();
    senses.emitNoise(position, 12);
  },
});

const match = createMatch({
  hud, audio,
  onRoundEnd(winner) {
    bots.setFrozen(true);
    bots.payRound(winner, match.state.lossStreak);
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
        ? `Vanguard takes Saltline Terminal ${match.state.scoreV}–${match.state.scoreS}. The port is yours.`
        : `Sentinel holds Saltline Terminal ${match.state.scoreS}–${match.state.scoreV}. Run it back.`,
    });
  },
  onSpikePlanted() { /* banner already shown by the match */ },
});

const bots = createBots(scene, world, senses, grenades, {
  audio,
  fireTracer: (from, to, colour) => weapon.fireVisual(from, to, colour),
  onKill(killer, victim, headshot) {
    hud.killfeed(killer, victim, headshot);
    if (killer === 'You') {
      match.addKillReward();
      audio.kill();
    }
  },
  onPlayerDamaged(amount, fromPos) {
    if (playerDead) return;
    player.damage(amount);
    hud.setHealth(body.health, body.armor);
    hud.damageFlash();
    // Damage direction: the bearing from the camera forward to the shooter.
    // cross = forward.x * tz - forward.z * tx, dot = forward . t; a positive
    // bearing is to the player's right, matching the CSS clockwise rotation.
    if (fromPos) {
      tempVec.copy(fromPos).sub(body.position);
      const fx = -Math.sin(body.yaw);
      const fz = -Math.cos(body.yaw);
      const cross = fx * tempVec.z - fz * tempVec.x;
      const dot = fx * tempVec.x + fz * tempVec.z;
      hud.damageDirection((Math.atan2(cross, dot) * 180) / Math.PI);
    }
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
    match.addPlantReward();
  },
  onSpikeDefused() {
    match.defuseSpike();
  },
  onCallout(text) {
    hud.comms(text);
  },
});

const raycaster = new THREE.Raycaster();
raycaster.far = 130;

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

function shoot() {
  const def = weapon.def();
  if (!weapon.takeRound()) {
    audio.dryFire();
    weapon.reload();
    return;
  }
  camera.getWorldDirection(aimDir);
  const spread = weapon.spread(player.groundSpeed(), body.crouched, body.airborne);
  const pellets = def.pellets;
  let anyHit = false;
  let anyKill = false;
  for (let p = 0; p < pellets; p += 1) {
    tempVec.copy(aimDir);
    tempVec.x += (random() * 2 - 1) * spread;
    tempVec.y += (random() * 2 - 1) * spread;
    tempVec.z += (random() * 2 - 1) * spread;
    tempVec.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, tempVec);
    const hits = raycaster.intersectObjects(world.shootables.concat(botHitMeshes()), false);
    const hit = hits[0];
    endPos.copy(hit ? hit.point : camera.position).addScaledVector(tempVec, hit ? 0 : def.range);
    if (hit) endPos.copy(hit.point);
    muzzlePos.copy(camera.position).addScaledVector(tempVec, 0.6);
    weapon.fireVisual(muzzlePos, endPos, def.tracer);
    if (hit && hit.object.userData.botRef) {
      const bot = hit.object.userData.botRef;
      const headshot = hit.object.userData.isHead === true;
      const dist = camera.position.distanceTo(hit.point);
      const damage = weapon.damageAt(dist, headshot);
      anyHit = true;
      const wasAlive = bot.alive;
      bots.damageBot(bot, damage, { name: 'You' }, headshot);
      if (wasAlive && !bot.alive) anyKill = true;
    }
  }
  if (anyHit) hud.hitMarker(anyKill);
  audio.shot(weapon.state.id);
  senses.emitNoise(camera.position, def.id === 'mastiff' ? 55 : 32);
  // Recoil follows the gun's pattern table, with a whisper of randomness on the
  // yaw so no two bursts land pixel-identical.
  const [kickPitch, kickYaw] = weapon.patternKick();
  player.recoil(kickPitch, kickYaw + (random() * 2 - 1) * 0.002);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, def.name);
}

function throwGrenade() {
  if (match.state.phase !== 'live' || playerDead) return;
  const kind = loadout.selected;
  if (loadout[kind] <= 0) return;
  camera.getWorldDirection(aimDir);
  muzzlePos.copy(camera.position).addScaledVector(aimDir, 0.5);
  if (grenades.throwGrenade(kind, muzzlePos, aimDir, 11)) {
    loadout[kind] -= 1;
    hud.setGrenades(loadout.flash, loadout.smoke, loadout.selected);
    senses.emitNoise(camera.position, 18);
  }
}

function checkRoundEnd() {
  const counts = bots.aliveCounts();
  const vAlive = counts.vanguard + (playerView.alive ? 1 : 0);
  const sAlive = counts.sentinel;
  if (match.state.phase !== 'live') return;
  // Clutch: the player is the last Vanguard standing against two or more.
  if (playerView.alive && vAlive === 1 && sAlive >= 2 && !clutchShown) {
    clutchShown = true;
    hud.banner('CLUTCH', `1v${sAlive} — last one standing, make it count`, true);
    hud.comms(CALLOUTS.clutch('You', 1, sAlive));
  }
  if (match.state.spike.status === 'planted') return; // spike decides it now
  if (sAlive === 0) match.endRound('vanguard', 'elimination');
  else if (vAlive === 0) match.endRound('sentinel', 'elimination');
}

function resetRoundPositions() {
  playerDead = false;
  playerView.alive = true;
  clutchShown = false;
  player.reset(SPAWNS.vanguard[0], 0);
  weapon.refill();
  loadout.flash = 1;
  loadout.smoke = 1;
  loadout.selected = 'flash';
  hud.setGrenades(1, 1, 'flash');
  bots.setFrozen(false);
  // The round plan: both teams pick a strat, the bots buy to their wallets,
  // and the HUD shows the attack strat and the team's buy.
  currentPlan = planRound(match.state.round, match.state.scoreV, match.state.scoreS, random);
  bots.spawnRound(random, currentPlan);
  hud.setStrat(currentPlan.vanguard.name);
  hud.comms(`STRAT: ${currentPlan.vanguard.name} — ${currentPlan.vanguard.call}`);
  if (bots.lastEconomy?.call) hud.comms(CALLOUTS.eco(bots.lastEconomy.call));
  for (const bot of bots.bots) {
    bot.smokedSite = false;
    bot.investigate = null;
    bot.blinded = 0;
    bot.body.group.traverse((mesh) => { mesh.userData.botRef = bot; });
  }
  hud.setHealth(100, body.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  hud.setPlant(null);
  hud.setSpike(null);
  hud.setScope(false);
  updateAliveHud();
}

function updateAliveHud() {
  const counts = bots.aliveCounts();
  hud.setAlive(counts.vanguard + (playerView.alive ? 1 : 0), counts.sentinel);
  // Enemies show on the minimap only while the player can actually see them.
  const visible = new Set();
  if (!playerDead) {
    for (const bot of bots.bots) {
      if (!bot.alive || bot.team !== 'sentinel') continue;
      tempVec.set(bot.position.x, 1.35, bot.position.z);
      if (senses.hasLOS(camera.position, tempVec, grenades.clouds)) visible.add(bot);
    }
  }
  hud.drawMinimap(
    world.colliders, body, bots.bots,
    match.state.spike.status === 'planted' || match.state.spike.status === 'dropped' ? match.state.spike.position : null,
    grenades.clouds, visible,
  );
}

function openBuy() {
  if (match.state.phase !== 'buy') return;
  buyOpen = true;
  if (document.pointerLockElement) document.exitPointerLock();
  const items = Object.entries(WEAPONS).map(([id, w], i) => ({
    id, key: String(i + 1), name: `${w.name} · ${w.kind}`, price: w.price,
    desc: `${w.damage} dmg · ${w.mag} rounds · ${Math.round(w.rate * 1000)}ms · ${w.pellets > 1 ? w.pellets + ' pellets' : 'bloom ' + w.bloomMax}`,
    buy: () => buyWeapon(id),
  }));
  items.push({
    id: 'armor', key: '6', name: 'Kevlar Vest', price: 650,
    desc: 'Soaks 60% of damage until depleted',
    buy: () => {
      if (match.buy('armor', 650)) {
        body.armor = 100;
        hud.setHealth(body.health, body.armor);
        openBuy();
      }
    },
  });
  items.push({
    id: 'flash', key: '7', name: 'Flashbang', price: FLASH_PRICE,
    desc: 'Blinds anyone looking at the burst — bots included',
    buy: () => {
      if (match.buy('flash', FLASH_PRICE)) {
        loadout.flash += 1;
        hud.setGrenades(loadout.flash, loadout.smoke, loadout.selected);
        openBuy();
      }
    },
  });
  items.push({
    id: 'smoke', key: '8', name: 'Smoke Grenade', price: SMOKE_PRICE,
    desc: 'A 14s cloud that cuts every sightline through it',
    buy: () => {
      if (match.buy('smoke', SMOKE_PRICE)) {
        loadout.smoke += 1;
        hud.setGrenades(loadout.flash, loadout.smoke, loadout.selected);
        openBuy();
      }
    },
  });
  items.push({
    id: 'kit', key: '9', name: 'Defuse Kit', price: 400,
    desc: 'Halves the defuse time — 2.5s instead of 5s. Lasts the match.',
    buy: () => {
      if (!loadout.hasKit && match.buy('kit', 400)) {
        loadout.hasKit = true;
        openBuy();
      }
    },
  });
  hud.showBuy(match.state.money, items, new Set([weapon.state.id, ...(loadout.hasKit ? ['kit'] : [])]),
    `TEAM BUY — ${bots.lastBuys.join(' · ')}`);
}

function buyWeapon(id) {
  const w = WEAPONS[id];
  if (!match.buy(id, w.price)) return;
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
    if (pressed('Digit6') && match.buy('armor', 650)) {
      body.armor = 100;
      hud.setHealth(body.health, body.armor);
      openBuy();
    }
    if (pressed('Digit7') && match.buy('flash', FLASH_PRICE)) {
      loadout.flash += 1;
      hud.setGrenades(loadout.flash, loadout.smoke, loadout.selected);
      openBuy();
    }
    if (pressed('Digit8') && match.buy('smoke', SMOKE_PRICE)) {
      loadout.smoke += 1;
      hud.setGrenades(loadout.flash, loadout.smoke, loadout.selected);
      openBuy();
    }
    if (pressed('Digit9') && !loadout.hasKit && match.buy('kit', 400)) {
      loadout.hasKit = true;
      openBuy();
    }
  }
  if (pressed('KeyQ')) {
    loadout.selected = loadout.selected === 'flash' ? 'smoke' : 'flash';
    hud.setGrenades(loadout.flash, loadout.smoke, loadout.selected);
  }
  if (pressed('Digit6') && !buyOpen) {
    loadout.selected = 'flash';
    hud.setGrenades(loadout.flash, loadout.smoke, loadout.selected);
  }
  if (pressed('Digit7') && !buyOpen) {
    loadout.selected = 'smoke';
    hud.setGrenades(loadout.flash, loadout.smoke, loadout.selected);
  }
  if (pressed('KeyG')) throwGrenade();
  if (pressed('KeyM')) {
    muted = !muted;
    audio.setEnabled(!muted);
  }
}

function plantDefuseStep(dt) {
  const spike = match.state.spike;
  const defuseSeconds = loadout.hasKit ? DEFUSE_SECONDS / 2 : DEFUSE_SECONDS;
  const inSite = (site) => body.position.distanceTo(tempVec.set(site.center.x, 0, site.center.z)) < site.radius;
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
        match.addPlantReward();
      }
    } else if (spike.status === 'planted' && body.position.distanceTo(spike.position) < 2) {
      kind = 'defuse';
      channel += dt;
      progress = channel / defuseSeconds;
      if (channel >= defuseSeconds) {
        channel = 0;
        if (loadout.hasKit) loadout.hasKit = false; // the kit is spent on the defuse
        match.defuseSpike();
      }
    }
  }
  if (kind === null) channel = 0;
  if (kind !== channelKind) channelKind = kind;
  hud.setPlant(kind === 'plant' ? 'PLANTING SPIKE — hold E' : kind === 'defuse' ? `DEFUSING — hold E${loadout.hasKit ? ' · kit' : ''}` : null, progress);
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
let targetFov = 74;

function step(dt) {
  elapsed += dt;
  handleKeys();
  if (!playerDead) player.step(dt, input.state.keys);
  playerView.moving = player.groundSpeed() > 0.5;
  playerView.crouched = body.crouched;
  weapon.step(dt, player.groundSpeed());
  senses.step(dt);
  grenades.step(dt);
  bots.step(dt, playerView, match.state.spike, grenades, match.state.phase === 'live');
  match.step(dt);
  plantDefuseStep(dt);
  checkRoundEnd();
  minimapTimer -= dt;
  if (minimapTimer <= 0) {
    minimapTimer = 0.25;
    updateAliveHud();
  }
  hud.setCrosshairSpread(4 + player.groundSpeed() * 1.2 + weapon.state.kick * 10 + weapon.state.bloom * 400);
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
    // Right mouse: the Mastiff scopes; a Falcon or Jackal aims down sights.
    // Scoped is the narrow sniper zoom, aiming is the smaller rifle ADS.
    const aiming = input.state.scoped && weapon.def().ads === true && !playerDead && match.state.phase === 'live';
    const scoped = input.state.scoped && weapon.def().scoped === true && !playerDead && match.state.phase === 'live';
    body.scoped = scoped;
    body.aiming = aiming;
    weapon.setAds(aiming);
    targetFov = scoped ? 28 : aiming ? 60 : 74;
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
      camera.updateProjectionMatrix();
    }
    hud.setScope(scoped);
    if (input.state.firing && weapon.ready() && !playerDead && match.state.phase === 'live') {
      shoot();
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
  // The harbour beacon blinks once a second and a half.
  world.beacon.visible = Math.floor(elapsed * 1.5) % 2 === 0;
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
  hud.clearComms();
  match.startMatch();
  hud.hideBanner();
  resetRoundPositions();
  bots.setFrozen(true);
  if (name === 'start') {
    body.position.set(0, 0, 24);
    body.yaw = 0.12;
    body.pitch = 0.01;
    settle(10);
    hud.showOverlay('start');
    hud.setTimer(BUY_SECONDS);
  } else if (name === 'buy') {
    body.position.set(-2, 0, 21);
    aimAt(new THREE.Vector3(-6, 1.4, 4));
    settle(10);
    // Stage a later round's full buy, not round 1's pistol eco: the bots'
    // wallets are topped up and they re-buy to their tiers.
    for (const bot of bots.bots) bot.wallet = 4500;
    bots.rebuy();
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
    // The execute, mid-firefight, down the West Flank: the team is pushing on
    // the round's strat call, a smoke cloud blooms on the far side of the lane
    // (in frame, clear of the shot line), a Sentinel stands in the open down
    // the lane, a second holds the right angle, and a Vanguard teammate is
    // visible on the left. The player fires until the target drops — the
    // killfeed entry that follows is the real kill, not a staged line.
    hud.comms(CALLOUTS.execute('Rook', currentPlan.vanguard.assignments[0].site));
    grenades.throwGrenade('smoke', new THREE.Vector3(-20, 1.5, 4), new THREE.Vector3(-0.79, 0.15, -0.61).normalize(), 11);
    settle(90);
    body.position.set(-20, 0, 4);
    const target = bots.bots.find((b) => b.team === 'sentinel' && b.alive);
    if (target) {
      target.position.set(-24, 0, -4);
      target.body.group.position.copy(target.position);
      target.body.group.rotation.y = Math.PI * 0.8;
      const second = bots.bots.find((b) => b.team === 'sentinel' && b.alive && b !== target);
      if (second) {
        second.position.set(-16, 0, -8);
        second.body.group.position.copy(second.position);
        second.body.group.rotation.y = Math.PI * 0.6;
      }
      const mate = bots.bots.find((b) => b.team === 'vanguard' && b.alive);
      if (mate) {
        mate.position.set(-23, 0, 0);
        mate.body.group.position.copy(mate.position);
        mate.body.group.rotation.y = Math.PI * 0.9;
      }
      for (let i = 0; i < 4 && target.alive; i += 1) {
        aimAt(new THREE.Vector3(-24, 1.7, -4));
        shoot();
        settle(2);
      }
    }
    updateAliveHud();
  } else if (name === 'end') {
    match.state.phase = 'ended';
    match.state.scoreV = 3;
    match.state.scoreS = 2;
    match.state.timeLeft = 2.5;
    hud.setScore(3, 2);
    hud.setTimer(2.5);
    match.plantSpike('A', new THREE.Vector3(-28, 0, -14));
    match.state.spike.timer = 12.4;
    hud.setSpike(12.4);
    hud.comms('Rook: spike down on A, hold the post-plant');
    body.position.set(-14, 0, -4);
    const mate = bots.bots.find((b) => b.team === 'vanguard' && b.alive);
    if (mate) {
      mate.position.set(-18, 0, -8);
      mate.body.group.position.copy(mate.position);
      // Facing back toward the player, so the amber visor reads in frame.
      mate.body.group.rotation.y = Math.PI * 0.85;
    }
    aimAt(new THREE.Vector3(-28, 1.2, -14));
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
// fastForward runs the fixed-step simulation ahead without rendering, so a
// play-test can watch whole rounds in seconds instead of minutes.
window.__saltline = {
  get phase() { return match.state.phase; },
  get round() { return match.state.round; },
  get score() { return [match.state.scoreV, match.state.scoreS]; },
  get money() { return match.state.money; },
  get spike() { return `${match.state.spike.status}:${match.state.spike.carrier === 'player' ? 'player' : match.state.spike.carrier?.name ?? '-'}`; },
  get plan() { return currentPlan ? currentPlan.vanguard.name : null; },
  fastForward(seconds) {
    const steps = Math.round(seconds / FIXED_STEP);
    for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
    return { phase: match.state.phase, round: match.state.round, score: [match.state.scoreV, match.state.scoreS] };
  },
  // Move the player, for play-tests that need the human out of the way (or in
  // harm's way) while the bots play the objective.
  teleport(x, z) {
    body.position.set(x, 0, z);
    body.velocity.set(0, 0, 0);
    syncCamera();
  },
  get grenades() { return { flash: loadout.flash, smoke: loadout.smoke, selected: loadout.selected }; },
  get player() {
    return {
      x: +body.position.x.toFixed(2), z: +body.position.z.toFixed(2),
      hp: Math.ceil(body.health), armor: Math.ceil(body.armor),
      weapon: weapon.state.id, mag: weapon.state.mag,
    };
  },
  get bots() {
    return bots.bots.map((b) => ({
      name: b.name, team: b.team, role: b.role, state: b.state, alive: b.alive, hp: Math.ceil(b.health),
      x: +b.position.x.toFixed(1), z: +b.position.z.toFixed(1),
      // Debug fields for play-tests: the waypoint path the bot is walking.
      path: b.path, pathIndex: b.pathIndex, slot: { x: +b.slot.x.toFixed(1), z: +b.slot.z.toFixed(1) },
      speed: +b.speed.toFixed(2), stratLane: b.stratLane,
      stuckCount: b.stuckCount, retakeRole: b.retakeRole, postPlant: b.postPlant, clutch: b.clutch,
      hasSpike: b.hasSpike, site: b.site,
      investigate: b.investigate ? [+b.investigate.x.toFixed(1), +b.investigate.z.toFixed(1)] : null,
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
hud.setGrenades(1, 1, 'flash');
hud.showOverlay('start');
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
