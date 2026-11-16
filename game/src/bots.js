// Bots: five enemies and four teammates, each running the same state machine. A bot
// walks the waypoint graph toward its objective, holds a post and scans, fights with
// strafing bursts once it spots an enemy, investigates the last gunshot it heard,
// and retakes a planted site in pairs — one of them smoking the doorway first. A
// flashbang blinds it: it stops, fires wild, and cannot see. Fights are hitscan with
// a hit chance that falls with distance and target speed, so a moving player is hard
// to hit and a standing one is not. Roles give the team shape: an entry fragger, a
// support, a lurker on the flank lane, and an AWPer who holds the long angle.
import * as THREE from 'three';
import { WAYPOINTS, SITES } from './world.js';
import { WEAPONS } from './weapon.js';
import { PALETTE } from './palette.js';
import { buyForBot, planEconomy, POST_PLANT, RETAKE_COVER, CALLOUTS } from './strat.js';

const NAMES_V = ['Rook', 'Havoc', 'Juno', 'Moss'];
const NAMES_S = ['Bishop', 'Warden', 'Kite', 'Sable', 'Frost'];
const ROLES_V = ['entry', 'support', 'lurker', 'awper'];
const ROLES_S = ['entry', 'support', 'lurker', 'awper', 'entry'];

const HALF = 0.35;
const HEIGHT = 1.7;

const eye = new THREE.Vector3();
const targetPos = new THREE.Vector3();
const probe = new THREE.Vector3();

function shortestPath(fromId, toId) {
  // Dijkstra over the waypoint graph, minimizing walked metres — not hops. A
  // hop-count search sends a retaking Sentinel on the 56 m north corridor
  // from site B to site A when the west flank is shorter, and the retake
  // then never arrives before the fuse runs out.
  if (fromId === toId) return [toId];
  const dist = new Map([[fromId, 0]]);
  const prev = new Map([[fromId, null]]);
  const done = new Set();
  while (true) {
    let current = -1;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < best) { best = d; current = id; }
    }
    if (current === -1) return [toId];
    if (current === toId) {
      const path = [toId];
      let node = toId;
      while (prev.get(node) !== null) { node = prev.get(node); path.unshift(node); }
      return path;
    }
    done.add(current);
    for (const next of WAYPOINTS[current].n) {
      const nd = dist.get(current) + WAYPOINTS[current].p.distanceTo(WAYPOINTS[next].p);
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd);
        prev.set(next, current);
      }
    }
  }
}

function nearestWaypoint(position) {
  let best = 0;
  let bestDist = Infinity;
  for (const w of WAYPOINTS) {
    const d = (w.p.x - position.x) ** 2 + (w.p.z - position.z) ** 2;
    if (d < bestDist) { bestDist = d; best = w.id; }
  }
  return best;
}

export function createBots(scene, world, senses, grenades, hooks) {
  const { audio, onKill, onPlayerDamaged, onSpikePlanted, onSpikeDefused, fireTracer, onCallout } = hooks;
  const bots = [];
  let frozen = false;
  let lastBuys = [];
  let lastEconomy = null;
  // v4 round state: the simulation clock (for stuck detection), the count of
  // Vanguard deaths before the plant (for the mid-round rotate), whether the
  // rotate already fired, and whether retake roles are assigned for this plant.
  let simTime = 0;
  let vanguardDeaths = 0;
  let rotated = false;
  let retakeAssigned = false;
  // The spike object of the round in progress, kept so a dying carrier can
  // drop it — damageBot runs outside step()'s parameter scope.
  let activeSpike = null;

  function makeBody(team) {
    const group = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({
      color: new THREE.Color(team === 'vanguard' ? '#2e3138' : '#232a2c'),
      roughness: 0.85,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: new THREE.Color(team === 'vanguard' ? PALETTE.amber : PALETTE.sentinel),
      roughness: 0.5,
    });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.32), suit);
    torso.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), suit);
    head.position.y = 1.72;
    head.userData.isHead = true;
    // Visor strip, unlit and bright, so a head is readable at a glance in the
    // dark — amber for Vanguard, teal for Sentinel, visible down a whole lane.
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.09, 0.02),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(team === 'vanguard' ? PALETTE.amber : PALETTE.sentinel) }),
    );
    visor.position.set(0, 1.74, -0.18);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), suit);
    legs.position.y = 0.4;
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.36), accent);
    shoulder.position.y = 1.5;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.7), new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c1e22'), roughness: 0.4, metalness: 0.6 }));
    gun.position.set(0.2, 1.3, -0.3);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.16), suit);
    pack.position.set(0, 1.2, 0.24);
    group.add(torso, head, visor, legs, shoulder, gun, pack);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.userData.botBody = true;
      }
    });
    torso.userData.isBody = true;
    legs.userData.isBody = true;
    scene.add(group);
    return { group, head, torso };
  }

  function spawnBot(name, team, role, spawn, weaponId) {
    const body = makeBody(team);
    body.group.position.copy(spawn);
    const bot = {
      name, team, role, weaponId, alive: true, health: 100, armor: 0,
      // A personal offset from the waypoint a bot holds, so teammates sharing a
      // post do not stand inside each other.
      slot: new THREE.Vector3(((bots.length % 3) - 1) * 1.6, 0, (bots.length % 2 === 0 ? 1.4 : -1.4)),
      position: spawn.clone(), yaw: team === 'vanguard' ? 0 : Math.PI,
      speed: role === 'awper' ? 3.0 : 3.4 + Math.random() * 0.5,
      path: [], pathIndex: 0, state: 'route',
      holdTimer: 0, reaction: 0, burstLeft: 0, burstPause: 0, cooldown: 0,
      strafeDir: 1, strafeTimer: 0,
      target: null, hasSpike: false, channel: 0, channelKind: null,
      blinded: 0, investigate: null, smokedSite: false,
      // Plan fields, set by applyPlan from the round's strat: the bot waits at
      // spawn until stratDelay, then walks its lane and throws execUtility on
      // the execute. wallet is the bot's own economy.
      wallet: 800, stratDelay: 0, stratLane: null, execUtility: null, hasExecuted: false,
      calledHit: false, calledRetake: false,
      // v4 fields: postPlant is the off-angle waypoint the bot holds after the
      // plant; retakeRole is 'defuse' or 'cover' once the spike is planted;
      // stallTime/stuckCount/sidestep* are the unstuck system (see moveBot);
      // clutch marks the last bot alive on its team.
      postPlant: null, retakeRole: null, coverWaypoint: null,
      stallTime: 0, stuckCount: 0, sidestepUntil: 0, sidestepX: 0, sidestepZ: 0,
      clutch: false, calledClutch: false, escortWait: 0,
      site: team === 'vanguard' ? (Math.random() < 0.6 ? 'A' : 'B') : null,
      body, moving: false,
    };
    bots.push(bot);
    return bot;
  }

  function spawnRound(random, plan = null) {
    // Wallets persist across rounds — a bot's economy is the match's memory.
    const savedWallets = new Map(bots.map((b) => [b.name, b.wallet]));
    for (const bot of bots) scene.remove(bot.body.group);
    bots.length = 0;
    const vSpawns = [[-4, 22], [-1.5, 23], [1, 22], [3.5, 23]];
    const sSpawns = [[-4, -22], [-1.5, -23], [1, -22], [3.5, -23], [0, -20.5]];
    vSpawns.forEach(([x, z], i) => {
      const bot = spawnBot(NAMES_V[i], 'vanguard', ROLES_V[i], new THREE.Vector3(x, 0, z), 'kestrel');
      bot.site = i < 2 ? 'A' : 'B';
      if (bot.role === 'lurker') bot.site = 'B';
    });
    sSpawns.forEach(([x, z], i) => {
      const bot = spawnBot(NAMES_S[i], 'sentinel', ROLES_S[i], new THREE.Vector3(x, 0, z), 'kestrel');
      bot.site = i < 2 ? 'A' : i < 4 ? 'B' : null; // Frost holds mid
    });
    // The round plan overwrites the defaults: each bot gets its site, its lane
    // and its execute delay from the strat, then buys to its wallet's tier.
    lastBuys = [];
    simTime = 0;
    vanguardDeaths = 0;
    rotated = false;
    retakeAssigned = false;
    // The team economy: a save round is decided for the whole team from the
    // average wallet, so five bots never buy five different tiers.
    lastEconomy = planEconomy(
      bots.filter((b) => b.team === 'vanguard'),
      bots.filter((b) => b.team === 'sentinel'),
    );
    if (plan) {
      const vTeam = bots.filter((b) => b.team === 'vanguard');
      const sTeam = bots.filter((b) => b.team === 'sentinel');
      vTeam.forEach((bot, i) => {
        const a = plan.vanguard.assignments[i];
        if (!a) return;
        bot.site = a.site;
        bot.stratLane = a.lane;
        bot.stratDelay = a.delay;
        bot.execUtility = a.utility;
        bot.hasExecuted = false;
        bot.calledHit = false;
        bot.calledRetake = false;
      });
      sTeam.forEach((bot, i) => {
        const a = plan.sentinel.assignments[i];
        if (!a) return;
        bot.site = a.site;
        bot.stratLane = a.lane;
        bot.stratDelay = a.delay;
        bot.execUtility = a.utility;
        bot.hasExecuted = false;
        bot.calledHit = false;
        bot.calledRetake = false;
      });
    }
    for (const bot of bots) {
      if (savedWallets.has(bot.name)) bot.wallet = savedWallets.get(bot.name);
      const forceEco = lastEconomy && (bot.team === 'vanguard' ? lastEconomy.vanguardEco : lastEconomy.sentinelEco);
      lastBuys.push(buyForBot(bot, forceEco));
    }
    void random;
  }

  // Post-plant assignment: the moment the spike goes down, every Vanguard bot
  // alive takes an off-angle from the plan's hold list, round-robin by index,
  // and drops its current path so it re-plans to the hold instead of standing
  // on the spike.
  function assignPostPlant(site) {
    const holds = POST_PLANT[site] ?? POST_PLANT.A;
    let i = 0;
    for (const bot of bots) {
      if (bot.team !== 'vanguard' || !bot.alive) continue;
      bot.postPlant = holds[i % holds.length];
      bot.path = [];
      i += 1;
    }
  }

  // Retake roles: the closest Sentinel alive to the planted spike defuses, the
  // rest cover from the hall approaches. Recomputed whenever the defuser dies,
  // so the defuse never waits on a corpse.
  function assignRetakeRoles(spike) {
    const alive = bots.filter((b) => b.team === 'sentinel' && b.alive);
    if (alive.length === 0) return;
    alive.sort((a, b) => a.position.distanceTo(spike.position) - b.position.distanceTo(spike.position));
    const covers = RETAKE_COVER[spike.site] ?? RETAKE_COVER.A;
    alive.forEach((bot, i) => {
      if (i === 0) {
        bot.retakeRole = 'defuse';
        bot.coverWaypoint = null;
      } else {
        bot.retakeRole = 'cover';
        bot.coverWaypoint = covers[(i - 1) % covers.length];
      }
      bot.path = [];
    });
    retakeAssigned = true;
  }

  // The bot's own box, 0.7 wide and 1.7 tall, against every collider. NOTE: this
  // used to alias its argument with the shared `probe` temp — collides(probe)
  // would shift the box by -HALF on both axes, so a bot walking east or north
  // could clip up to 0.35 m into a container and then wedge there forever,
  // every later move failing both axes. The box is computed into locals first.
  function collides(pos) {
    const minX = pos.x - HALF;
    const maxX = pos.x + HALF;
    const minZ = pos.z - HALF;
    const maxZ = pos.z + HALF;
    for (const c of world.colliders) {
      if (minX < c.max.x && maxX > c.min.x && pos.y < c.max.y && (pos.y + HEIGHT) > c.min.y && minZ < c.max.z && maxZ > c.min.z) return true;
    }
    return false;
  }

  // Unstuck: a bot that has pushed against the same wall for 2.5 s sidesteps
  // perpendicular to its heading for a second, then resumes on a fresh plan.
  // Without this, a retaking Sentinel steering straight at a spike planted
  // flush against a container wedges there until the fuse runs out — the v3
  // bug, seen once at the site-A approach. The stall clock only runs while the
  // bot is trying to move; holding a post never counts as stuck.
  function moveBot(bot, dt, tx, tz) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) { bot.stallTime = 0; return true; }
    // A sidestep is never an arrival: reaching the sidestep point is not
    // reaching the waypoint, or the bot declares the walk done while still
    // wedged on the same corner — the v4 bug that left Sable holding at the
    // site-B container for a whole round with a finished path.
    if (simTime < bot.sidestepUntil) {
      moveToward(bot, dt, bot.sidestepX, bot.sidestepZ);
      return false;
    }
    const beforeX = bot.position.x;
    const beforeZ = bot.position.z;
    const arrived = moveToward(bot, dt, tx, tz);
    const moved = Math.hypot(bot.position.x - beforeX, bot.position.z - beforeZ);
    if (moved < 0.01) {
      bot.stallTime += dt;
      if (bot.stallTime > 2.5) {
        bot.stallTime = 0;
        bot.stuckCount += 1;
        bot.path = []; // a fresh Dijkstra plan from where it actually is
        const px = -(dz / dist);
        const pz = dx / dist;
        const side = bot.stuckCount % 2 === 0 ? 1 : -1;
        bot.sidestepX = bot.position.x + px * side * 2;
        bot.sidestepZ = bot.position.z + pz * side * 2;
        bot.sidestepUntil = simTime + 1;
      }
    } else {
      bot.stallTime = 0;
    }
    return arrived;
  }

  // The single-axis slide itself, shared by the direct walk and the sidestep:
  // try x, then z, so a bot slides along a wall instead of stopping on it.
  function moveToward(bot, dt, tx, tz) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) return true;
    const stepLen = Math.min(dist, bot.speed * dt);
    const nx = bot.position.x + (dx / dist) * stepLen;
    const nz = bot.position.z + (dz / dist) * stepLen;
    probe.set(nx, 0, bot.position.z);
    if (!collides(probe)) bot.position.x = nx;
    probe.set(bot.position.x, 0, nz);
    if (!collides(probe)) bot.position.z = nz;
    bot.yaw = Math.atan2(-(dx / dist), -(dz / dist));
    bot.moving = true;
    return dist < 0.4;
  }

  function visibleEnemies(bot, player, clouds) {
    const enemies = [];
    eye.copy(bot.position);
    eye.y = 1.55;
    // The player is Vanguard: only Sentinel bots treat them as an enemy. A
    // Vanguard bot that spots its own player holds fire — without this, a
    // teammate pushing up Crane Row shoots the player standing in front of
    // him, because the sight test never asked whose side the target is on.
    if (bot.team === 'sentinel' && player.alive) {
      targetPos.copy(player.position);
      targetPos.y = 1.35;
      const strength = senses.spotStrength(eye, bot.yaw, targetPos, player.crouched, clouds);
      if (strength > 0.25) enemies.push({ kind: 'player', pos: targetPos.clone(), dist: eye.distanceTo(targetPos), ref: player, strength });
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      targetPos.copy(other.position);
      targetPos.y = 1.35;
      const strength = senses.spotStrength(eye, bot.yaw, targetPos, false, clouds);
      if (strength > 0.25) enemies.push({ kind: 'bot', pos: targetPos.clone(), dist: eye.distanceTo(targetPos), ref: other, strength });
    }
    enemies.sort((a, b) => b.strength - a.strength);
    return enemies;
  }

  function shootAt(bot, enemy, dt) {
    const w = WEAPONS[bot.weaponId];
    bot.cooldown -= dt;
    if (bot.cooldown > 0) return;
    if (bot.burstLeft <= 0) {
      if (bot.burstPause > 0) { bot.burstPause -= dt; return; }
      // Burst discipline: tap at range, short bursts mid, spray up close — a
      // bot that holds its trigger down a lane wastes its mag on the wall.
      // The AWPer and the Boar always fire single shots.
      bot.burstLeft = bot.weaponId === 'boar' || bot.weaponId === 'mastiff' ? 1
        : enemy.dist > 25 ? 1 + Math.floor(Math.random() * 2)
        : enemy.dist > 12 ? 2 + Math.floor(Math.random() * 2)
        : 4 + Math.floor(Math.random() * 2);
      bot.burstPause = enemy.dist > 25 ? 0.8 + Math.random() * 0.4
        : enemy.dist > 12 ? 0.6 + Math.random() * 0.4
        : 0.4 + Math.random() * 0.3;
    }
    bot.burstLeft -= 1;
    bot.cooldown = w.rate * (bot.weaponId === 'mastiff' ? 1 : 1.6);
    const muzzle = bot.position.clone();
    muzzle.y = 1.45;
    muzzle.x += -Math.sin(bot.yaw) * 0.5;
    muzzle.z += -Math.cos(bot.yaw) * 0.5;
    const moving = enemy.ref.moving ? 1 : 0;
    // Aim skill: the AWPer is deadlier down a lane and weaker up close, the
    // entry fragger a touch sharper than the rest — and a bot that stands
    // still to shoot lands more than one strafing, so long-range duels are
    // fought planted, not on the move.
    const roleSkill = bot.role === 'awper' ? (enemy.dist > 20 ? 1.15 : 0.9)
      : bot.role === 'entry' ? 1.05 : 1;
    let pHit = Math.max(0.08, Math.min(0.6,
      (0.52 - enemy.dist * 0.009 - moving * 0.12) * roleSkill + (bot.moving ? 0 : 0.08)));
    if (bot.blinded > 0) pHit = 0.05; // blind fire: wild, almost never lands
    const hit = Math.random() < pHit;
    const headshot = hit && Math.random() < 0.12;
    let end;
    if (hit) {
      end = enemy.pos.clone();
      const damage = headshot ? w.headDamage : w.damage;
      if (enemy.kind === 'player') {
        onPlayerDamaged(damage, bot.position.clone());
      } else {
        damageBot(enemy.ref, damage, bot, headshot);
      }
    } else {
      end = enemy.pos.clone();
      end.x += (Math.random() - 0.5) * 2.2;
      end.y += (Math.random() - 0.5) * 1.2;
      end.z += (Math.random() - 0.5) * 2.2;
    }
    fireTracer(muzzle, end, w.tracer);
    audio.enemyShot(enemy.dist);
  }

  function damageBot(bot, amount, attacker, headshot = false) {
    if (!bot.alive) return;
    bot.health -= amount;
    if (bot.health <= 0) {
      bot.alive = false;
      bot.health = 0;
      bot.body.group.rotation.x = -Math.PI / 2;
      bot.body.group.position.y = 0.25;
      // A Vanguard death before the plant counts toward the mid-round rotate:
      // two lost on the push and the survivors switch sites.
      if (bot.team === 'vanguard' && activeSpike && activeSpike.status !== 'planted') vanguardDeaths += 1;
      // The defuser dying hands the retake to the next closest Sentinel.
      if (bot.team === 'sentinel' && bot.retakeRole === 'defuse') retakeAssigned = false;
      if (attacker && attacker.name) onKill(attacker.name, bot.name, headshot);
      // A kill pays $300 into the killer's wallet, bot or player.
      if (attacker && attacker.wallet != null) attacker.wallet += 300;
      // A dead carrier drops the spike where he fell, so a teammate can
      // take it up instead of the round stalling on a corpse.
      if (bot.hasSpike && activeSpike) {
        bot.hasSpike = false;
        activeSpike.status = 'dropped';
        activeSpike.position.copy(bot.position);
        activeSpike.carrier = null;
      }
    }
  }

  function objectiveFor(bot, spike) {
    // Returns a waypoint id to walk to.
    if (bot.team === 'sentinel') {
      if (spike.status === 'planted') return spike.site === 'A' ? 13 : 14;
      if (bot.investigate) return nearestWaypoint(bot.investigate);
      if (bot.role === 'lurker') return 15; // west wall flank
      if (bot.role === 'awper') return 5; // long angle down Crane Row
      if (bot.site) return bot.site === 'A' ? 13 : 14;
      return 5; // mid hold
    }
    if (spike.status === 'dropped') return nearestWaypoint(spike.position);
    if (bot.investigate) return nearestWaypoint(bot.investigate);
    if (bot.role === 'lurker') return bot.site === 'A' ? 15 : 16; // flank lane
    if (bot.hasSpike) return bot.site === 'A' ? 13 : 14;
    // Escort the carrier: while the spike is still far from the site, the team
    // converges on the carrier instead of trickling to the site on its own —
    // a carrier pushing alone is the first body in the lane, and the round
    // dies with him. Once the pack is together (or the site is close), the
    // whole team pushes the site.
    if (spike.status === 'carried') {
      const carrier = spike.carrier;
      if (carrier && carrier !== 'player' && carrier.alive) {
        const siteCenter = SITES[bot.site].center;
        if (carrier.position.distanceTo(siteCenter) > 15
          && bot.position.distanceTo(carrier.position) > 8) {
          return nearestWaypoint(carrier.position);
        }
      }
      return bot.site === 'A' ? 13 : 14;
    }
    // Planted: hold the assigned post-plant off-angle, not the spike itself.
    if (spike.status === 'planted' && bot.postPlant != null) return bot.postPlant;
    return bot.site === 'A' ? 13 : 14;
  }

  function walkTo(bot, dt, targetId) {
    if (bot.path.length === 0 || bot.path[bot.path.length - 1] !== targetId) {
      bot.path = shortestPath(nearestWaypoint(bot.position), targetId);
      bot.pathIndex = 0;
    }
    // A path planned from an older position can start at a waypoint the bot
    // has already passed (a Sentinel that was holding site A retaking the
    // same site, so the target never changed and the path was never
    // re-planned). At the start of a path only, skip a first node the bot
    // is already well past, or re-plan from where the bot actually is.
    // (Re-planning on every step oscillates — the north hall's waypoints
    // are close together, so the nearest one flips as the bot walks.)
    if (bot.pathIndex === 0 && bot.path.length > 1) {
      const first = WAYPOINTS[bot.path[0]].p;
      const second = WAYPOINTS[bot.path[1]].p;
      const dFirst = bot.position.distanceTo(first);
      const dSecond = bot.position.distanceTo(second);
      if (dFirst > 5 && dSecond < dFirst) bot.pathIndex = 1;
      else if (dFirst > 8) {
        bot.path = shortestPath(nearestWaypoint(bot.position), targetId);
        bot.pathIndex = 0;
      }
    }
    if (bot.pathIndex < bot.path.length) {
      const node = WAYPOINTS[bot.path[bot.pathIndex]];
      const last = bot.pathIndex === bot.path.length - 1;
      const tx = node.p.x + (last ? bot.slot.x : 0);
      const tz = node.p.z + (last ? bot.slot.z : 0);
      if (moveBot(bot, dt, tx, tz)) bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    return true;
  }

  function step(dt, player, spike, grenadesApi, canFight = true) {
    activeSpike = spike;
    simTime += dt;
    const clouds = grenadesApi.clouds;
    // Mid-round rotate: two Vanguard deaths on the push with the spike still
    // carried, and the survivors switch sites together instead of feeding
    // the same angle one by one. Once per round; the lurker calls it. It only
    // fires while the spike is carried — a dropped spike dictates the site,
    // because the team has to recover it where it lies, and rotating the site
    // while the spike is down sends the carrier to the far site once he picks
    // it up, forty metres from where the round actually is.
    if (!rotated && vanguardDeaths >= 2 && spike.status === 'carried') {
      rotated = true;
      const survivors = bots.filter((b) => b.team === 'vanguard' && b.alive);
      const caller = survivors.find((b) => b.role === 'lurker') ?? survivors[0];
      const newSite = survivors[0] ? (survivors[0].site === 'A' ? 'B' : 'A') : 'A';
      for (const bot of survivors) {
        bot.site = newSite;
        bot.stratLane = null;
        bot.path = [];
      }
      if (caller && onCallout) onCallout(CALLOUTS.rotate(caller.name, newSite));
    }
    // Retake roles are assigned the moment the spike goes down, and again
    // whenever the defuser dies (damageBot clears retakeAssigned).
    if (canFight && spike.status === 'planted' && !retakeAssigned) assignRetakeRoles(spike);
    for (const bot of bots) {
      if (!bot.alive || frozen) continue;
      bot.moving = false;
      if (bot.blinded > 0) bot.blinded -= dt;

      // Clutch: the last bot alive on its team plays for the round, not the
      // duel — faster reactions, and a Sentinel clutch goes straight for the
      // defuse instead of trading shots.
      if (!bot.clutch) {
        const mates = bots.filter((b) => b.team === bot.team && b.alive);
        if (mates.length === 1 && mates[0] === bot) {
          bot.clutch = true;
          if (!bot.calledClutch && onCallout) {
            bot.calledClutch = true;
            const foes = bots.filter((b) => b.team !== bot.team && b.alive).length;
            onCallout(CALLOUTS.clutch(bot.name, 1, foes));
          }
        }
      }

      // Hearing: a recent gunshot inside earshot pulls a bot off its post to
      // investigate — unless it is already fighting or planting.
      if (canFight && !bot.target) {
        const noise = senses.hearAt(bot.position);
        if (noise && noise.position.distanceTo(bot.position) > 4) {
          bot.investigate = noise.position;
        } else if (bot.investigate && bot.position.distanceTo(bot.investigate) < 3) {
          bot.investigate = null;
        }
      }

      // The plant beats a duel: a carrier standing in the site plants the
      // spike instead of trading shots — the round is won on the objective,
      // and the carrier's teammates are the ones who cover him. Without
      // this, a carrier who picks the spike up in a held site fights the
      // holders for the rest of the round and never plants.
      if (canFight && bot.team === 'vanguard' && bot.hasSpike && spike.status === 'carried') {
        const site = SITES[bot.site];
        if (bot.position.distanceTo(site.center) < site.radius) {
          bot.channel += dt;
          bot.channelKind = 'plant';
          if (bot.channel >= 3) {
            bot.channel = 0;
            bot.hasSpike = false;
            assignPostPlant(bot.site);
            if (onCallout) onCallout(CALLOUTS.plant(bot.name, bot.site));
            onSpikePlanted(bot.site, bot.position.clone());
          }
          bot.body.group.position.copy(bot.position);
          bot.body.group.rotation.y = bot.yaw;
          continue;
        }
      }

      // Fight first: an enemy in sight beats any objective. A Sentinel holding
      // a site calls the hit once, so the team knows where the push is coming.
      // Two exceptions: a dropped spike nearby beats a duel — a Vanguard bot
      // within 10 m of it breaks off to recover it instead of strafing in
      // place while the round stalls with the spike lying at mid — and beyond
      // 10 m the closest Vanguard bot to the spike still breaks off, so a
      // duel on the flank never stalls the recovery while the spike lies at
      // the site.
      const enemies = canFight ? visibleEnemies(bot, player, clouds) : [];
      let spikeNear = false;
      if (canFight && bot.team === 'vanguard' && spike.status === 'dropped') {
        const d = bot.position.distanceTo(spike.position);
        if (d < 10) spikeNear = true;
        else {
          spikeNear = true;
          for (const mate of bots) {
            if (mate.team === 'vanguard' && mate.alive && mate !== bot
              && mate.position.distanceTo(spike.position) < d) { spikeNear = false; break; }
          }
        }
      }
      // A retaking Sentinel does not abandon the defuse for a distant duel:
      // within 15 m of a planted spike the defuser (or a clutch Sentinel)
      // only fights an enemy closer than 8 m, and otherwise keeps walking to
      // the site. Cover bots are exempt — fighting is their job.
      const retaking = canFight && bot.team === 'sentinel' && spike.status === 'planted'
        && (bot.retakeRole === 'defuse' || bot.clutch)
        && bot.position.distanceTo(spike.position) < 15
        && enemies.every((e) => e.dist > 8);
      // A carrier does not take long duels: the spike is the round, and a
      // carrier trading shots at twenty metres is a carrier not planting.
      // Only a close threat is worth the carrier's gun — anything farther,
      // the carrier pushes and the escort fights.
      const carrierPush = bot.hasSpike && enemies.every((e) => e.dist > 15);
      if (enemies.length > 0 && !spikeNear && !retaking && !carrierPush) {
        const enemy = enemies[0];
        bot.state = 'fight';
        if (bot.target !== enemy.ref) {
          bot.target = enemy.ref;
          // Reaction time: faster up close and dead ahead, slower at range —
          // and faster still in a clutch, when the round is on one trigger.
          bot.reaction = (0.55 - Math.min(0.3, enemy.strength * 0.3) + Math.random() * 0.15) * (bot.clutch ? 0.6 : 1);
          bot.strafeTimer = 0;
          if (bot.team === 'sentinel' && !bot.calledHit && onCallout) {
            bot.calledHit = true;
            const pushers = enemies.length;
            onCallout(CALLOUTS.hit(bot.name, bot.site ?? 'MID', pushers));
            // The mid rover rotates to the hit site on the call — a site hold
            // that never gets reinforced is a site lost.
            if (bot.site) {
              for (const mate of bots) {
                if (mate.team === 'sentinel' && mate.alive && mate.site == null && mate !== bot) {
                  mate.investigate = SITES[bot.site].center.clone();
                }
              }
            }
          }
        }
        const dx = enemy.pos.x - bot.position.x;
        const dz = enemy.pos.z - bot.position.z;
        bot.yaw = Math.atan2(-dx, -dz);
        if (bot.reaction > 0) {
          bot.reaction -= dt;
        } else {
          // Strafe while shooting: sidestep, flip direction every half second,
          // so a duelling bot is a moving target, not a turret. At long range
          // a bot plants its feet instead — standing still is what makes the
          // shot land down a lane, and strafing there only wastes the burst.
          const holdStill = enemy.dist > 22;
          bot.strafeTimer -= dt;
          if (bot.strafeTimer <= 0) {
            bot.strafeDir *= -1;
            bot.strafeTimer = 0.4 + Math.random() * 0.4;
          }
          if (bot.blinded <= 0 && !holdStill) {
            const sx = Math.cos(bot.yaw) * bot.strafeDir;
            const sz = -Math.sin(bot.yaw) * bot.strafeDir;
            probe.set(bot.position.x + sx * bot.speed * 0.6 * dt, 0, bot.position.z + sz * bot.speed * 0.6 * dt);
            if (!collides(probe)) {
              bot.position.x = probe.x;
              bot.position.z = probe.z;
              bot.moving = true;
            }
            // Push while duelling: at range, a bot advances on the enemy
            // instead of strafing in place, so a fight moves the team toward
            // its objective — and onto a dropped spike — instead of stalling
            // mid-map for the whole round.
            if (enemy.dist > 12) {
              const adv = bot.speed * 0.5 * dt;
              probe.set(bot.position.x + (dx / enemy.dist) * adv, 0, bot.position.z + (dz / enemy.dist) * adv);
              if (!collides(probe)) {
                bot.position.x = probe.x;
                bot.position.z = probe.z;
                bot.moving = true;
              }
            }
          }
          shootAt(bot, enemy, dt);
        }
        bot.body.group.position.copy(bot.position);
        bot.body.group.rotation.y = bot.yaw;
        continue;
      }
      bot.target = null;

      // Retake: one Sentinel defuses, the rest cover. The defuser smokes the
      // door on the way in and works the spike; the covers hold the hall
      // approaches and fight anyone coming to stop him, instead of queuing
      // on the spike behind him.
      if (canFight && bot.team === 'sentinel' && spike.status === 'planted') {
        bot.state = 'retake';
        if (!bot.calledRetake && onCallout && bot.retakeRole !== 'cover') {
          bot.calledRetake = true;
          onCallout(CALLOUTS.retake(bot.name, spike.site));
        }
        if (bot.retakeRole === 'cover') {
          const coverId = bot.coverWaypoint ?? (spike.site === 'A' ? 9 : 11);
          const arrived = walkTo(bot, dt, coverId);
          if (arrived) {
            bot.state = 'hold';
            bot.holdTimer += dt;
            bot.yaw += Math.sin(bot.holdTimer * 0.7) * dt * 0.5;
          }
          bot.body.group.position.copy(bot.position);
          bot.body.group.rotation.y = bot.yaw;
          continue;
        }
        const site = SITES[spike.site];
        if (!bot.smokedSite && bot.position.distanceTo(site.center) < 14) {
          bot.smokedSite = true;
          const dir = new THREE.Vector3(site.center.x - bot.position.x, 0, site.center.z - bot.position.z).normalize();
          grenadesApi.throwGrenade('smoke', bot.position.clone().setY(1.5), dir, 9);
        }
        if (bot.position.distanceTo(spike.position) < 1.6) {
          if (bot.channel === 0 && onCallout) onCallout(CALLOUTS.defuse(bot.name, spike.site));
          bot.channel += dt;
          bot.channelKind = 'defuse';
          if (bot.channel >= 5) {
            bot.channel = 0;
            onSpikeDefused();
          }
          bot.body.group.position.copy(bot.position);
          bot.body.group.rotation.y = bot.yaw;
          continue;
        }
        // Walk the graph to the site, then steer straight at the spike once
        // close — the site waypoint alone can sit 2 m from where the spike
        // actually lies, which is outside the 1.6 m defuse reach. The steer
        // runs through moveBot, so the unstuck sidestep rescues a defuser
        // wedged on a container face.
        if (bot.position.distanceTo(spike.position) < 6) {
          moveBot(bot, dt, spike.position.x, spike.position.z);
        } else {
          walkTo(bot, dt, spike.site === 'A' ? 13 : 14);
        }
        bot.body.group.position.copy(bot.position);
        bot.body.group.rotation.y = bot.yaw;
        continue;
      }

      // (The plant itself runs before the fight branch above: a carrier in
      // the site plants instead of duelling. Reaching here means the carrier
      // is not in the site, so any partial channel is dropped.)
      bot.channel = 0;
      bot.channelKind = null;

      // Pick up a dropped spike. This runs before the execute clock, so a bot
      // standing on the spike takes it even while the team is still waiting.
      // The pickup names the site: the whole Vanguard team plays for the site
      // the spike is actually near, not the one the plan (or a rotate) named
      // while the spike lay elsewhere — a carrier walking forty metres to the
      // far site is a round thrown away, and a team split across two sites is
      // two duels lost instead of one site taken.
      if (spike.status === 'dropped' && bot.team === 'vanguard') {
        if (bot.position.distanceTo(spike.position) < 1.8) {
          bot.hasSpike = true;
          bot.stratLane = null; // the carrier goes straight to the site
          spike.status = 'carried';
          spike.carrier = bot;
          const nearSite = spike.position.distanceTo(SITES.A.center) < spike.position.distanceTo(SITES.B.center) ? 'A' : 'B';
          for (const mate of bots) {
            if (mate.team === 'vanguard' && mate.alive) mate.site = nearSite;
          }
          bot.body.group.position.copy(bot.position);
          bot.body.group.rotation.y = bot.yaw;
          continue;
        }
      }

      // The execute clock: the team waits at spawn, then the entry fragger
      // throws his utility and the push starts together — no trickling in one
      // by one. The clock only runs while the round is live. Smoke fires on
      // the clock; a flash waits for the door (see the entry flash below) —
      // a flash thrown from spawn blinds the holders for 2.5 s that expire
      // before the team arrives.
      if (canFight && bot.stratDelay > 0) {
        bot.stratDelay -= dt;
        bot.state = 'setup';
        if (bot.stratDelay <= 0 && bot.execUtility && bot.execUtility !== 'flash' && !bot.hasExecuted && bot.site) {
          bot.hasExecuted = true;
          const site = SITES[bot.site];
          const dir = new THREE.Vector3(site.center.x - bot.position.x, 0, site.center.z - bot.position.z).normalize();
          const from = bot.position.clone();
          from.y = 1.5;
          grenadesApi.throwGrenade(bot.execUtility, from, dir, 11);
        }
        bot.body.group.position.copy(bot.position);
        bot.body.group.rotation.y = bot.yaw;
        continue;
      }

      // Entry flash: the flash is thrown when the entry fragger reaches the
      // site door, not on the execute clock — a flash thrown from spawn
      // blinds the holders for 2.5 s that expire before the team arrives,
      // while a flash on entry blinds them exactly as the team pushes in
      // behind it, and the push wins the duels it was losing. The door is
      // 25 m out, not 15: at 15 the entry fragger is already inside the
      // holders' kill zone and dies before the flash leaves his hand, while
      // at 25 he is still at long range — hard to hit — and the flash lands
      // in the site as the pack arrives behind it.
      if (canFight && bot.team === 'vanguard' && bot.execUtility === 'flash' && !bot.hasExecuted && bot.site) {
        const site = SITES[bot.site];
        if (bot.position.distanceTo(site.center) < 25) {
          bot.hasExecuted = true;
          const dir = new THREE.Vector3(site.center.x - bot.position.x, 0, site.center.z - bot.position.z).normalize();
          const from = bot.position.clone();
          from.y = 1.5;
          grenadesApi.throwGrenade('flash', from, dir, 11);
          if (onCallout) onCallout(CALLOUTS.execute(bot.name, bot.site));
        }
      }

      // The carrier waits for the pack: pushing a site alone with the spike is
      // how rounds are lost — the carrier holds up to 4 s for a teammate to
      // close within 12 m, then pushes regardless. The escort is converging
      // on him by the objective above, so the wait is short.
      if (bot.hasSpike && spike.status === 'carried') {
        const mateNear = bots.some((b) => b.team === 'vanguard' && b.alive && b !== bot
          && b.position.distanceTo(bot.position) < 12);
        if (!mateNear && bot.escortWait < 4) {
          bot.escortWait += dt;
          bot.state = 'hold';
          bot.holdTimer += dt;
          bot.yaw += Math.sin(bot.holdTimer * 0.7) * dt * 0.5;
          bot.body.group.position.copy(bot.position);
          bot.body.group.rotation.y = bot.yaw;
          continue;
        }
        bot.escortWait = 0;
      }

      // Walk the waypoint graph toward the objective; hold the post when arrived.
      // A bot with a strat lane walks the lane first, then the site behind it —
      // unless the spike is dropped, which overrides everything: the whole team
      // detours to it, and a bot that reaches its waypoint steers straight at
      // the spike instead of holding, because the nearest waypoint can still be
      // metres from where it fell.
      bot.state = 'route';
      let targetId = bot.stratLane != null ? bot.stratLane : objectiveFor(bot, spike);
      if (spike.status === 'dropped' && bot.team === 'vanguard') {
        bot.stratLane = null;
        targetId = nearestWaypoint(spike.position);
      }
      const arrived = walkTo(bot, dt, targetId);
      if (arrived && bot.stratLane != null && targetId === bot.stratLane) bot.stratLane = null;
      if (arrived && bot.stratLane == null) {
        if (spike.status === 'dropped' && bot.team === 'vanguard' && bot.position.distanceTo(spike.position) < 6) {
          moveBot(bot, dt, spike.position.x, spike.position.z);
        } else {
          bot.state = 'hold';
          bot.holdTimer += dt;
          // Scan: sweep the yaw slowly across the lane the post watches.
          bot.yaw += Math.sin(bot.holdTimer * 0.7) * dt * 0.5;
        }
      }
      bot.body.group.position.copy(bot.position);
      bot.body.group.rotation.y = bot.yaw;
    }
  }

  function aliveCounts() {
    let v = 0;
    let s = 0;
    for (const bot of bots) {
      if (!bot.alive) continue;
      if (bot.team === 'vanguard') v += 1; else s += 1;
    }
    return { vanguard: v, sentinel: s };
  }

  function reset() {
    for (const bot of bots) scene.remove(bot.body.group);
    bots.length = 0;
  }

  return {
    bots, spawnRound, step, damageBot, aliveCounts, reset,
    get lastBuys() { return lastBuys; },
    get lastEconomy() { return lastEconomy; },
    // Re-buy for every bot from its current wallet — used by the buy-phase
    // capture, which stages a later round's full buy instead of round 1's eco.
    rebuy() {
      lastBuys = [];
      for (const bot of bots) lastBuys.push(buyForBot(bot));
    },
    // Round payout, mirroring the player's economy: a win pays $3,250, a loss
    // pays more the longer the streak runs — the next round's buy tier follows.
    payRound(winner, lossStreak) {
      for (const bot of bots) {
        if (bot.team === winner) bot.wallet += 3250;
        else bot.wallet += Math.min(2900, 1400 + lossStreak * 500);
      }
    },
    setFrozen(value) { frozen = value; },
    blindBotsAt(position, range) {
      for (const bot of bots) {
        if (!bot.alive) continue;
        eye.copy(bot.position);
        eye.y = 1.55;
        targetPos.copy(position);
        targetPos.y = 1.5;
        if (eye.distanceTo(targetPos) < range && senses.hasLOS(eye, targetPos, [])) {
          bot.blinded = 2.5;
          bot.target = null;
        }
      }
    },
  };
}
