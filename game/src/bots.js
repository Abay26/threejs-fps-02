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

const NAMES_V = ['Rook', 'Havoc', 'Juno', 'Moss'];
const NAMES_S = ['Bishop', 'Warden', 'Kite', 'Sable', 'Frost'];
const ROLES_V = ['entry', 'support', 'lurker', 'awper'];
const ROLES_S = ['entry', 'support', 'lurker', 'awper', 'entry'];

const HALF = 0.35;
const HEIGHT = 1.7;

const eye = new THREE.Vector3();
const targetPos = new THREE.Vector3();
const probe = new THREE.Vector3();

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

export function createBots(scene, world, senses, grenades, hooks) {
  const { audio, onKill, onPlayerDamaged, onSpikePlanted, onSpikeDefused, fireTracer } = hooks;
  const bots = [];
  let frozen = false;

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
    // Visor strip, so a head is readable at a glance in the dark.
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.02), accent);
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
      site: team === 'vanguard' ? (Math.random() < 0.6 ? 'A' : 'B') : null,
      body, moving: false,
    };
    bots.push(bot);
    return bot;
  }

  function spawnRound(random) {
    for (const bot of bots) scene.remove(bot.body.group);
    bots.length = 0;
    const vSpawns = [[-4, 22], [-1.5, 23], [1, 22], [3.5, 23]];
    const sSpawns = [[-4, -22], [-1.5, -23], [1, -22], [3.5, -23], [0, -20.5]];
    const vWeapons = ['falcon', 'jackal', 'boar', 'mastiff'];
    const sWeapons = ['falcon', 'falcon', 'jackal', 'mastiff', 'boar'];
    vSpawns.forEach(([x, z], i) => {
      const bot = spawnBot(NAMES_V[i], 'vanguard', ROLES_V[i], new THREE.Vector3(x, 0, z), vWeapons[i]);
      bot.site = i < 2 ? 'A' : 'B';
      if (bot.role === 'lurker') bot.site = 'B';
    });
    sSpawns.forEach(([x, z], i) => {
      const bot = spawnBot(NAMES_S[i], 'sentinel', ROLES_S[i], new THREE.Vector3(x, 0, z), sWeapons[i]);
      bot.site = i < 2 ? 'A' : i < 4 ? 'B' : null; // Frost holds mid
    });
    void random;
  }

  function collides(pos) {
    probe.set(pos.x - HALF, pos.y, pos.z - HALF);
    const maxX = pos.x + HALF;
    const maxZ = pos.z + HALF;
    for (const c of world.colliders) {
      if (probe.x < c.max.x && maxX > c.min.x && probe.y < c.max.y && (pos.y + HEIGHT) > c.min.y && probe.z < c.max.z && maxZ > c.min.z) return true;
    }
    return false;
  }

  function moveBot(bot, dt, tx, tz) {
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
    if (player.alive) {
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
      bot.burstLeft = bot.weaponId === 'boar' ? 1 : 3 + Math.floor(Math.random() * 3);
      bot.burstPause = 0.5 + Math.random() * 0.7;
    }
    bot.burstLeft -= 1;
    bot.cooldown = w.rate * (bot.weaponId === 'mastiff' ? 1 : 1.6);
    const muzzle = bot.position.clone();
    muzzle.y = 1.45;
    muzzle.x += -Math.sin(bot.yaw) * 0.5;
    muzzle.z += -Math.cos(bot.yaw) * 0.5;
    const moving = enemy.ref.moving ? 1 : 0;
    let pHit = Math.max(0.08, Math.min(0.55, 0.52 - enemy.dist * 0.009 - moving * 0.12));
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
      if (attacker && attacker.name) onKill(attacker.name, bot.name, headshot);
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
    if (spike.status === 'carried') return bot.site === 'A' ? 13 : 14; // escort the carrier
    return bot.site === 'A' ? 13 : 14;
  }

  function walkTo(bot, dt, targetId) {
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
      return bot.pathIndex >= bot.path.length;
    }
    return true;
  }

  function step(dt, player, spike, grenadesApi, canFight = true) {
    const clouds = grenadesApi.clouds;
    for (const bot of bots) {
      if (!bot.alive || frozen) continue;
      bot.moving = false;
      if (bot.blinded > 0) bot.blinded -= dt;

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

      // Fight first: an enemy in sight beats any objective.
      const enemies = canFight ? visibleEnemies(bot, player, clouds) : [];
      if (enemies.length > 0) {
        const enemy = enemies[0];
        bot.state = 'fight';
        if (bot.target !== enemy.ref) {
          bot.target = enemy.ref;
          // Reaction time: faster up close and dead ahead, slower at range.
          bot.reaction = 0.55 - Math.min(0.3, enemy.strength * 0.3) + Math.random() * 0.15;
          bot.strafeTimer = 0;
        }
        const dx = enemy.pos.x - bot.position.x;
        const dz = enemy.pos.z - bot.position.z;
        bot.yaw = Math.atan2(-dx, -dz);
        if (bot.reaction > 0) {
          bot.reaction -= dt;
        } else {
          // Strafe while shooting: sidestep, flip direction every half second,
          // so a duelling bot is a moving target, not a turret.
          bot.strafeTimer -= dt;
          if (bot.strafeTimer <= 0) {
            bot.strafeDir *= -1;
            bot.strafeTimer = 0.4 + Math.random() * 0.4;
          }
          if (bot.blinded <= 0) {
            const sx = Math.cos(bot.yaw) * bot.strafeDir;
            const sz = -Math.sin(bot.yaw) * bot.strafeDir;
            probe.set(bot.position.x + sx * bot.speed * 0.6 * dt, 0, bot.position.z + sz * bot.speed * 0.6 * dt);
            if (!collides(probe)) {
              bot.position.x = probe.x;
              bot.position.z = probe.z;
              bot.moving = true;
            }
          }
          shootAt(bot, enemy, dt);
        }
        bot.body.group.position.copy(bot.position);
        bot.body.group.rotation.y = bot.yaw;
        continue;
      }
      bot.target = null;

      // Retake: when the spike is planted, Sentinels converge on the site, and
      // the first one through the door smokes it.
      if (canFight && bot.team === 'sentinel' && spike.status === 'planted') {
        bot.state = 'retake';
        const site = SITES[spike.site];
        if (!bot.smokedSite && bot.position.distanceTo(site.center) < 14) {
          bot.smokedSite = true;
          const dir = new THREE.Vector3(site.center.x - bot.position.x, 0, site.center.z - bot.position.z).normalize();
          grenadesApi.throwGrenade('smoke', bot.position.clone().setY(1.5), dir, 9);
        }
        if (bot.position.distanceTo(spike.position) < 1.6) {
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
        walkTo(bot, dt, spike.site === 'A' ? 13 : 14);
        bot.body.group.position.copy(bot.position);
        bot.body.group.rotation.y = bot.yaw;
        continue;
      }

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
          bot.body.group.position.copy(bot.position);
          bot.body.group.rotation.y = bot.yaw;
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
          bot.body.group.position.copy(bot.position);
          bot.body.group.rotation.y = bot.yaw;
          continue;
        }
      }

      // Walk the waypoint graph toward the objective; hold the post when arrived.
      bot.state = 'route';
      const targetId = objectiveFor(bot, spike);
      const arrived = walkTo(bot, dt, targetId);
      if (arrived) {
        bot.state = 'hold';
        bot.holdTimer += dt;
        // Scan: sweep the yaw slowly across the lane the post watches.
        bot.yaw += Math.sin(bot.holdTimer * 0.7) * dt * 0.5;
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
