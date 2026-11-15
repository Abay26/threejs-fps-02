// Senses: what a bot can see and hear. One module owns every line-of-sight test so
// the bots, the grenades and the player all agree about the same world. Sight is a
// raycast against the world's shootables, blocked by smoke; hearing is an event list
// the gunfire and the spike feed, and bots investigate the loudest recent noise.
// A bot's field of view is a cone: a target dead ahead is spotted at full range, one
// at the edge only when close. All scratch vectors are module-level, so a sight test
// never allocates in the hot loop.
import * as THREE from 'three';

const raycaster = new THREE.Raycaster();
const dir = new THREE.Vector3();
const toTarget = new THREE.Vector3();
const forward = new THREE.Vector3();
const cloudDelta = new THREE.Vector3();

export function createSenses(world) {
  // Recent noises: { position, radius, age }. Heard by bots within radius.
  const noises = [];

  function emitNoise(position, radius) {
    noises.push({ position: position.clone(), radius, age: 0 });
    if (noises.length > 24) noises.shift();
  }

  function step(dt) {
    for (let i = noises.length - 1; i >= 0; i -= 1) {
      noises[i].age += dt;
      if (noises[i].age > 6) noises.splice(i, 1);
    }
  }

  function hearAt(position) {
    let best = null;
    let bestScore = 0;
    for (const n of noises) {
      const d = position.distanceTo(n.position);
      if (d > n.radius) continue;
      const score = (1 - d / n.radius) / (1 + n.age);
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  // True when the straight line from eye to target is not cut by a wall, a crate,
  // or a smoke cloud. Smoke is a list of { position, radius } the grenade module
  // owns; a segment through any cloud is blind.
  function blockedBySmoke(from, to, clouds) {
    for (const c of clouds) {
      if (!c.active) continue;
      // Segment-sphere test: closest point on the segment to the cloud centre.
      toTarget.subVectors(to, from);
      const lenSq = toTarget.lengthSq();
      if (lenSq === 0) continue;
      const t = Math.max(0, Math.min(1, cloudDelta.subVectors(c.position, from).dot(toTarget) / lenSq));
      const cx = from.x + toTarget.x * t;
      const cy = from.y + toTarget.y * t;
      const cz = from.z + toTarget.z * t;
      const dx = cx - c.position.x;
      const dy = cy - c.position.y;
      const dz = cz - c.position.z;
      if (dx * dx + dy * dy + dz * dz < c.radius * c.radius) return true;
    }
    return false;
  }

  function hasLOS(from, to, clouds = []) {
    dir.subVectors(to, from);
    const dist = dir.length();
    if (dist > 110) return false;
    if (blockedBySmoke(from, to, clouds)) return false;
    raycaster.set(from, dir.normalize());
    raycaster.far = dist;
    return raycaster.intersectObjects(world.shootables, false).length === 0;
  }

  // A bot spots a target it can see: inside its view cone, in line of sight, and
  // closer when the target is crouched or still. Returns a 0..1 spot strength.
  function spotStrength(eye, yaw, target, crouched, clouds = []) {
    toTarget.subVectors(target, eye);
    const dist = toTarget.length();
    if (dist > 70) return 0;
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const cosAngle = forward.dot(toTarget.normalize());
    const fov = 0.55; // cos(56 deg) — the bot's view cone
    if (cosAngle < fov) return 0;
    if (!hasLOS(eye, target, clouds)) return 0;
    const facing = (cosAngle - fov) / (1 - fov); // 0 at the edge, 1 dead ahead
    const range = 1 - dist / 70;
    const still = crouched ? 0.55 : 1;
    return Math.max(0, Math.min(1, (0.35 + facing * 0.5 + range * 0.4) * still));
  }

  return { emitNoise, hearAt, hasLOS, spotStrength, step };
}
