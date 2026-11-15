// Bots: four teammates and five enemies, all running the same brain. A bot walks the
// waypoint graph toward its objective, stops to fight when it sees an enemy, plants the
// spike if it carries it, and defuses when the spike is down. Fights are hitscan with a
// hit chance that falls with distance and target speed, so a moving player is hard to hit
// and a standing one is not.
import * as THREE from 'three';
import { WAYPOINTS, SITES } from './world.js';
import { WEAPONS } from './weapon.js';
import { PALETTE } from './palette.js';

const NAMES_V = ['Rook', 'Havoc', 'Juno', 'Moss'];
const NAMES_S = ['Bishop', 'Warden', 'Kite', 'Sable', 'Frost'];

const HALF = 0.35;
const HEIGHT = 1.7;

function bfsPath(fromId, toId) {
  if (fromId === toId) return [toId];
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of WAYPOINTS[current].n) {
      if (!prev.has(next)) {
        prev.set(next, current);
        if (next === toId) {
          const path = [toId];
          let node = next;
          while (prev.get(node) !== null) {
            node = prev.get(node);
            path.unshift(node);
          }
          return path;
        }
        queue.push(next);
      }
    }
  }
  return [toId];
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

export function createBots(scene, world, hooks) {
  const { audio, onKill, onPlayerDamaged, onSpikePlanted, onSpikeDefused, fireTracer } = hooks;
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const bots = [];
  let frozen = false;

  function makeBody(team) {
    const group = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({
      color: new THREE.Color(team === 'vanguard' ? '#3d3a33' : '#2c3436'),
      roughness: 0.85,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: new THREE.Color(team === 'vanguard' ? PALETTE.amber : PALETTE.teal),
      roughness: 0.5,
    });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.32), suit);
    torso.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), accent);
    head.position.y = 1.72;
    head.userData.isHead = true;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), suit);
    legs.position.y = 0.4;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.7), new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c1e22'), roughness: 0.4, metalness: 0.6 }));
    gun.position.set(0.2, 1.3, -0.3);
    group.add(torso, head, legs, gun);
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

  function spawnBot(name, team, spawn, weaponId) {
    const body = makeBody(team);
    body.group.position.copy(spawn);
    const bot = {
      name, team, weaponId, alive: true, health: 100, armor: 0,
      // A personal offset from the waypoint a bot holds, so teammates sharing a
      // post do not stand inside each other.
      slot: new THREE.Vector3(((bots.length % 3) - 1) * 1.6, 0, (bots.length % 2 === 0 ? 1.4 : -1.4)),
      position: spawn.clone(), yaw: team === 'vanguard' ? 0 : Math.PI,
      speed: 3.4 + Math.random() * 0.5, path: [], pathIndex: 0,
      holdTimer: 0, reaction: 0, burstLeft: 0, burstPause: 0, cooldown: 0,
      target: null, hasSpike: false, channel: 0, channelKind: null,
      site: team === 'vanguard' ? (Math.random() < 0.6 ? 'A' : 'B') : null,
      body, moving: false,
    };
    bots.push(bot);
    return bot;
  }

  function spawnRound(random) {
    for (const bot of bots) scene.remove(bot.body.group);
    bots.length = 0;
    const vSpawns = [[-4, 19], [-1.5, 20], [1, 19], [3.5, 20]];
    const sSpawns = [[-4, -19], [-1.5, -20], [1, -19], [3.5, -20], [0, -17.5]];
    const vWeapons = ['falcon', 'jackal', 'falcon', 'mastiff'];
    const sWeapons = ['falcon', 'falcon', 'jackal', 'mastiff', 'falcon'];
    vSpawns.forEach(([x, z], i) => {
      const bot = spawnBot(NAMES_V[i], 'vanguard', new THREE.Vector3(x, 0, z), vWeapons[i]);
      bot.site = i < 2 ? 'A' : 'B';
    });
    sSpawns.forEach(([x, z], i) => {
      const bot = spawnBot(NAMES_S[i], 'sentinel', new THREE.Vector3(x, 0, z), sWeapons[i]);
      bot.site = i < 2 ? 'A' : i < 4 ? 'B' : null; // Frost holds mid
    });
    void random;
  }

  function collides(pos) {
    const box = new THREE.Box3(
      new THREE.Vector3(pos.x - HALF, pos.y, pos.z - HALF),
      new THREE.Vector3(pos.x + HALF, pos.y + HEIGHT, pos.z + HALF),
    );
    for (const c of world.colliders) if (box.intersectsBox(c)) return true;
    return false;
  }

  function moveBot(bot, dt, tx, tz) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) return true;
    const step = Math.min(dist, bot.speed * dt);
    const nx = bot.position.x + (dx / dist) * step;
    const nz = bot.position.z + (dz / dist) * step;
    const probe = bot.position.clone();
    probe.x = nx;
    if (!collides(probe)) bot.position.x = nx;
    probe.set(bot.position.x, 0, nz);
    if (!collides(probe)) bot.position.z = nz;
    bot.yaw = Math.atan2(-(dx / dist), -(dz / dist));
    bot.moving = true;
    return dist < 0.4;
  }

  function hasLineOfSight(from, to) {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist > 90) return false;
    raycaster.set(from, dir.normalize());
    raycaster.far = dist;
    return raycaster.intersectObjects(world.shootables, false).length === 0;
  }

  function visibleEnemies(bot, player) {
    const enemies = [];
    const eye = bot.position.clone();
    eye.y = 1.55;
    if (player.alive) {
      const target = player.position.clone();
      target.y = 1.35;
      if (hasLineOfSight(eye, target)) enemies.push({ kind: 'player', pos: target, dist: eye.distanceTo(target), ref: player });
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      const target = other.position.clone();
      target.y = 1.35;
      if (hasLineOfSight(eye, target)) enemies.push({ kind: 'bot', pos: target, dist: eye.distanceTo(target), ref: other });
    }
    enemies.sort((a, b) => a.dist - b.dist);
    return enemies;
  }

  function shootAt(bot, enemy, dt) {
    const w = WEAPONS[bot.weaponId];
    bot.cooldown -= dt;
    if (bot.cooldown > 0) return;
    if (bot.burstLeft <= 0) {
      if (bot.burstPause > 0) { bot.burstPause -= dt; return; }
      bot.burstLeft = 3 + Math.floor(Math.random() * 3);
      bot.burstPause = 0.5 + Math.random() * 0.7;
    }
    bot.burstLeft -= 1;
    bot.cooldown = w.rate * (bot.weaponId === 'mastiff' ? 1 : 1.6);
    const muzzle = bot.position.clone();
    muzzle.y = 1.45;
    muzzle.x += -Math.sin(bot.yaw) * 0.5;
    muzzle.z += -Math.cos(bot.yaw) * 0.5;
    const moving = enemy.ref.moving ? 1 : 0;
    const pHit = Math.max(0.08, Math.min(0.55, 0.52 - enemy.dist * 0.009 - moving * 0.12));
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
      if (attacker && attacker.name) onKill(attacker.name, bot.name, headshot);
    }
  }

  function objectiveFor(bot, spike) {
    // Returns a waypoint id to walk to.
    if (bot.team === 'sentinel') {
      if (spike.status === 'planted') return spike.site === 'A' ? 13 : 14;
      if (bot.site) return bot.site === 'A' ? 13 : 14;
      return 5; // mid hold
    }
    if (spike.status === 'dropped') {
      return nearestWaypoint(spike.position);
    }
    if (bot.hasSpike) return bot.site === 'A' ? 13 : 14;
    if (spike.status === 'carried') return bot.site === 'A' ? 13 : 14; // escort the carrier
    return bot.site === 'A' ? 13 : 14;
  }

  function step(dt, player, spike, canFight = true) {
    for (const bot of bots) {
      if (!bot.alive || frozen) continue;
      bot.moving = false;
      // During the buy phase bots walk to their posts but never fight, plant or
      // defuse: the round has not started yet.
      const enemies = canFight ? visibleEnemies(bot, player) : [];
      if (enemies.length > 0) {
        const enemy = enemies[0];
        if (bot.target !== enemy.ref) {
          bot.target = enemy.ref;
          bot.reaction = 0.25 + Math.random() * 0.35;
        }
        const dx = enemy.pos.x - bot.position.x;
        const dz = enemy.pos.z - bot.position.z;
        bot.yaw = Math.atan2(-dx, -dz);
        if (bot.reaction > 0) {
          bot.reaction -= dt;
        } else {
          shootAt(bot, enemy, dt);
        }
        continue;
      }
      bot.target = null;

      // Spike duties before walking (live rounds only).
      if (canFight && bot.team === 'vanguard' && bot.hasSpike && spike.status === 'carried') {
        const site = SITES[bot.site];
        if (bot.position.distanceTo(site.center) < site.radius) {
          bot.channel += dt;
          bot.channelKind = 'plant';
          if (bot.channel >= 3) {
            bot.channel = 0;
            onSpikePlanted(bot.site, bot.position.clone());
          }
          continue;
        }
      }
      if (canFight && bot.team === 'sentinel' && spike.status === 'planted') {
        if (bot.position.distanceTo(spike.position) < 1.6) {
          bot.channel += dt;
          bot.channelKind = 'defuse';
          if (bot.channel >= 5) {
            bot.channel = 0;
            onSpikeDefused();
          }
          continue;
        }
      }
      bot.channel = 0;
      bot.channelKind = null;

      // Pick up a dropped spike.
      if (spike.status === 'dropped' && bot.team === 'vanguard') {
        if (bot.position.distanceTo(spike.position) < 1.2) {
          bot.hasSpike = true;
          spike.status = 'carried';
          spike.carrier = bot;
          continue;
        }
      }

      // Walk the waypoint graph toward the objective.
      const targetId = objectiveFor(bot, spike);
      if (bot.path.length === 0 || bot.path[bot.path.length - 1] !== targetId) {
        bot.path = bfsPath(nearestWaypoint(bot.position), targetId);
        bot.pathIndex = 0;
      }
      if (bot.pathIndex < bot.path.length) {
        const node = WAYPOINTS[bot.path[bot.pathIndex]];
        const last = bot.pathIndex === bot.path.length - 1;
        const tx = node.p.x + (last ? bot.slot.x : 0);
        const tz = node.p.z + (last ? bot.slot.z : 0);
        if (moveBot(bot, dt, tx, tz)) bot.pathIndex += 1;
      } else {
        bot.holdTimer += dt;
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
    setFrozen(value) { frozen = value; },
  };
}
