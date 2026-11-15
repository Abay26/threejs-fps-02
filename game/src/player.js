// The human player: a capsule that walks, sprints, crouches and jumps through the yard,
// colliding axis by axis against the world's AABBs. Health, armour and the recoil that
// feeds back into the camera live here too.
import * as THREE from 'three';

const HALF = 0.35; // half-width of the player's box
const HEIGHT = 1.7;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.15;

export function createPlayer(colliders, spawn) {
  const state = {
    position: spawn.clone(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: EYE_STAND,
    crouched: false,
    grounded: true,
    health: 100,
    armor: 0,
  };
  let recoilPitch = 0;
  let recoilYaw = 0;

  function collides(pos) {
    const min = new THREE.Vector3(pos.x - HALF, pos.y, pos.z - HALF);
    const max = new THREE.Vector3(pos.x + HALF, pos.y + HEIGHT, pos.z + HALF);
    const box = new THREE.Box3(min, max);
    for (const c of colliders) if (box.intersectsBox(c)) return true;
    return false;
  }

  function moveAxis(delta) {
    const next = state.position.clone().add(delta);
    if (!collides(next)) {
      state.position.copy(next);
      return true;
    }
    return false;
  }

  function step(dt, keys) {
    const sprinting = keys.has('ShiftLeft') && !state.crouched;
    const speed = state.crouched ? 2.4 : sprinting ? 6.4 : 4.6;
    const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
    const wish = new THREE.Vector3();
    if (keys.has('KeyW')) wish.add(forward);
    if (keys.has('KeyS')) wish.sub(forward);
    if (keys.has('KeyD')) wish.add(right);
    if (keys.has('KeyA')) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    state.velocity.x = wish.x;
    state.velocity.z = wish.z;

    // Vertical: gravity and jump, landing on y = 0.
    state.velocity.y -= 22 * dt;
    if (keys.has('Space') && state.grounded) {
      state.velocity.y = 7.2;
      state.grounded = false;
    }
    const dy = state.velocity.y * dt;
    state.position.y += dy;
    if (state.position.y <= 0) {
      state.position.y = 0;
      state.velocity.y = 0;
      state.grounded = true;
    }

    moveAxis(new THREE.Vector3(state.velocity.x * dt, 0, 0));
    moveAxis(new THREE.Vector3(0, 0, state.velocity.z * dt));

    // Crouch eases the eye height down; standing back up is instant.
    const targetEye = keys.has('ControlLeft') ? EYE_CROUCH : EYE_STAND;
    state.crouched = keys.has('ControlLeft');
    state.eye += (targetEye - state.eye) * Math.min(1, dt * 12);

    // Recoil decays back to zero.
    recoilPitch *= Math.max(0, 1 - dt * 9);
    recoilYaw *= Math.max(0, 1 - dt * 9);
  }

  function look(dx, dy) {
    state.yaw -= dx * 0.0021;
    state.pitch -= dy * 0.0021;
    state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch));
  }

  function recoil(pitch, yaw) {
    recoilPitch += pitch;
    recoilYaw += yaw;
  }

  function cameraPitch() { return state.pitch + recoilPitch; }
  function cameraYaw() { return state.yaw + recoilYaw; }

  function groundSpeed() {
    return Math.hypot(state.velocity.x, state.velocity.z);
  }

  function damage(amount) {
    // Armour soaks 60% of a hit until it runs out.
    let remaining = amount;
    if (state.armor > 0) {
      const soaked = Math.min(state.armor, remaining * 0.6);
      state.armor -= soaked;
      remaining -= soaked;
    }
    state.health = Math.max(0, state.health - remaining);
    return state.health;
  }

  function reset(spawnPoint, yaw) {
    state.position.copy(spawnPoint);
    state.velocity.set(0, 0, 0);
    state.yaw = yaw;
    state.pitch = 0;
    state.health = 100;
    state.eye = EYE_STAND;
    recoilPitch = 0;
    recoilYaw = 0;
  }

  return {
    state, step, look, recoil, cameraPitch, cameraYaw, groundSpeed, damage, reset,
  };
}
