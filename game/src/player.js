// The human player: a capsule that accelerates into its run instead of snapping to
// full speed, so stopping to aim pays and sprinting into a corner costs control.
// Walk, sprint, crouch and jump through the terminal, colliding axis by axis against
// the world's AABBs. Health, armour and the recoil that feeds back into the camera
// live here too. Scope state lives here as well: the sniper's right-click zoom is a
// property of the player, not of the gun.
import * as THREE from 'three';

const HALF = 0.35; // half-width of the player's box
const HEIGHT = 1.7;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.15;
const ACCEL_GROUND = 42;
const ACCEL_AIR = 10;
const FRICTION = 11;

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const wish = new THREE.Vector3();
const minBox = new THREE.Vector3();
const maxBox = new THREE.Vector3();
const delta = new THREE.Vector3();

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
    scoped: false,
    airborne: false,
  };
  let recoilPitch = 0;
  let recoilYaw = 0;

  function collides(pos) {
    minBox.set(pos.x - HALF, pos.y, pos.z - HALF);
    maxBox.set(pos.x + HALF, pos.y + HEIGHT, pos.z + HALF);
    for (const c of colliders) {
      if (minBox.x < c.max.x && maxBox.x > c.min.x && minBox.y < c.max.y && maxBox.y > c.min.y && minBox.z < c.max.z && maxBox.z > c.min.z) return true;
    }
    return false;
  }

  function moveAxis(dx, dz) {
    delta.set(state.position.x + dx, state.position.y, state.position.z + dz);
    if (!collides(delta)) {
      state.position.x += dx;
      state.position.z += dz;
      return true;
    }
    return false;
  }

  function step(dt, keys) {
    const sprinting = keys.has('ShiftLeft') && !state.crouched && !state.scoped;
    const speed = state.crouched ? 2.4 : sprinting ? 6.6 : 4.6;
    forward.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    right.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
    wish.set(0, 0, 0);
    if (keys.has('KeyW')) wish.add(forward);
    if (keys.has('KeyS')) wish.sub(forward);
    if (keys.has('KeyD')) wish.add(right);
    if (keys.has('KeyA')) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    // Acceleration, not teleportation: the velocity chases the wish velocity, fast
    // on the ground and sluggish in the air; with no input, friction bleeds it off.
    const accel = state.grounded ? ACCEL_GROUND : ACCEL_AIR;
    state.velocity.x += (wish.x - state.velocity.x) * Math.min(1, accel * dt / Math.max(1, speed));
    state.velocity.z += (wish.z - state.velocity.z) * Math.min(1, accel * dt / Math.max(1, speed));
    if (wish.lengthSq() === 0 && state.grounded) {
      const f = Math.max(0, 1 - FRICTION * dt);
      state.velocity.x *= f;
      state.velocity.z *= f;
    }

    // Vertical: gravity and jump, landing on y = 0.
    state.velocity.y -= 22 * dt;
    if (keys.has('Space') && state.grounded) {
      state.velocity.y = 7.2;
      state.grounded = false;
    }
    state.position.y += state.velocity.y * dt;
    if (state.position.y <= 0) {
      state.position.y = 0;
      state.velocity.y = 0;
      state.grounded = true;
    }
    state.airborne = !state.grounded;

    moveAxis(state.velocity.x * dt, 0);
    moveAxis(0, state.velocity.z * dt);

    // Crouch eases the eye height down; standing back up is instant.
    const targetEye = keys.has('ControlLeft') ? EYE_CROUCH : EYE_STAND;
    state.crouched = keys.has('ControlLeft');
    state.eye += (targetEye - state.eye) * Math.min(1, dt * 12);

    // Recoil decays back to zero.
    recoilPitch *= Math.max(0, 1 - dt * 9);
    recoilYaw *= Math.max(0, 1 - dt * 9);
  }

  function look(dx, dy) {
    const sens = state.scoped ? 0.00075 : 0.0021;
    state.yaw -= dx * sens;
    state.pitch -= dy * sens;
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
    state.scoped = false;
    recoilPitch = 0;
    recoilYaw = 0;
  }

  return {
    state, step, look, recoil, cameraPitch, cameraYaw, groundSpeed, damage, reset,
  };
}
