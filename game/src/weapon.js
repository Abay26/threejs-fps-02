// Weapons: four guns with their own damage, rate, spread and price, a low-poly viewmodel
// built from boxes that bobs and kicks, and the visible side of every shot — a tracer
// line, a muzzle flash and impact sparks that fade over a few frames.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  kestrel: {
    name: 'Kestrel', kind: 'Pistol', price: 0, damage: 34, headDamage: 100,
    rate: 0.16, mag: 12, reserve: 36, reload: 1.1, spread: 0.006, range: 60,
    auto: false, tracer: 0xffe1a0,
  },
  falcon: {
    name: 'Falcon', kind: 'Rifle', price: 2700, damage: 33, headDamage: 132,
    rate: 0.1, mag: 30, reserve: 90, reload: 2.2, spread: 0.004, range: 90,
    auto: true, tracer: 0xffc860,
  },
  jackal: {
    name: 'Jackal', kind: 'SMG', price: 1500, damage: 26, headDamage: 104,
    rate: 0.07, mag: 32, reserve: 96, reload: 1.8, spread: 0.009, range: 55,
    auto: true, tracer: 0xffe1a0,
  },
  mastiff: {
    name: 'Mastiff', kind: 'Sniper', price: 4750, damage: 110, headDamage: 220,
    rate: 1.1, mag: 5, reserve: 15, reload: 3.1, spread: 0.0008, range: 120,
    auto: false, tracer: 0xfff2c0,
  },
};

export function createWeapon(camera, audio) {
  const state = {
    id: 'kestrel', mag: WEAPONS.kestrel.mag, reserve: WEAPONS.kestrel.reserve,
    cooldown: 0, reloading: 0, bobPhase: 0, kick: 0, flash: 0,
  };

  // Viewmodel: a gun assembled from dark boxes, held low-right of the camera.
  const gun = new THREE.Group();
  const gunMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#23262b'), roughness: 0.45, metalness: 0.6 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.amber), roughness: 0.4, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.52), gunMat);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), gunMat);
  barrel.position.set(0, 0.03, -0.36);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), gunMat);
  grip.position.set(0, -0.13, 0.18);
  grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accentMat);
  sight.position.set(0, 0.09, -0.1);
  gun.add(body, barrel, grip, sight);
  gun.position.set(0.26, -0.24, -0.5);
  camera.add(gun);

  // Muzzle flash: a small radial starburst sprite at the barrel tip, so a frozen shot
  // never shows a flat square.
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 64;
  flashCanvas.height = 64;
  const flashCtx = flashCanvas.getContext('2d');
  const gradient = flashCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
  gradient.addColorStop(0, 'rgba(255, 240, 190, 1)');
  gradient.addColorStop(0.4, 'rgba(255, 190, 90, 0.85)');
  gradient.addColorStop(1, 'rgba(255, 140, 40, 0)');
  flashCtx.fillStyle = gradient;
  flashCtx.fillRect(0, 0, 64, 64);
  const flashTexture = new THREE.CanvasTexture(flashCanvas);
  const flashMat = new THREE.MeshBasicMaterial({
    map: flashTexture, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), flashMat);
  flash.position.set(0.26, -0.2, -0.95);
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color('#ffb35c'), 0, 9);
  flashLight.position.set(0.3, -0.1, -1.2);
  camera.add(flashLight);

  // Tracers and impact sparks, pooled so a firefight never allocates.
  const tracerGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
  const tracers = [];
  for (let i = 0; i < 24; i += 1) {
    const line = new THREE.Line(tracerGeo, new THREE.LineBasicMaterial({
      color: 0xffc860, transparent: true, opacity: 0,
    }));
    line.frustumCulled = false;
    camera.parent.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(60 * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xffd27a, size: 0.07, transparent: true, opacity: 0,
  }));
  sparks.frustumCulled = false;
  camera.parent.add(sparks);
  let sparkLife = 0;

  function def() { return WEAPONS[state.id]; }

  function equip(id) {
    const w = WEAPONS[id];
    state.id = id;
    state.mag = w.mag;
    state.reserve = w.reserve;
    state.reloading = 0;
    state.cooldown = 0;
    gun.scale.setScalar(id === 'mastiff' ? 1.25 : id === 'jackal' ? 0.9 : 1);
  }

  function refill() {
    state.mag = def().mag;
    state.reserve = def().reserve;
  }

  function ready() {
    return state.cooldown <= 0 && state.reloading <= 0;
  }

  function takeRound() {
    if (state.mag <= 0) return false;
    state.mag -= 1;
    state.cooldown = def().rate;
    state.kick = 1;
    state.flash = 1;
    return true;
  }

  function reload() {
    if (state.reloading > 0 || state.mag === def().mag || state.reserve <= 0) return;
    state.reloading = def().reload;
    audio.reload();
  }

  function fireVisual(from, to, colour) {
    const t = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % tracers.length;
    const positions = t.line.geometry.attributes.position;
    positions.setXYZ(0, from.x, from.y, from.z);
    positions.setXYZ(1, to.x, to.y, to.z);
    positions.needsUpdate = true;
    t.line.material.color.setHex(colour);
    t.line.material.opacity = 0.9;
    t.life = 0.09;
    // Impact sparks at the far end.
    for (let i = 0; i < 12; i += 1) {
      sparkPos[i * 3] = to.x + (Math.random() - 0.5) * 0.3;
      sparkPos[i * 3 + 1] = to.y + (Math.random() - 0.5) * 0.3;
      sparkPos[i * 3 + 2] = to.z + (Math.random() - 0.5) * 0.3;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparks.material.opacity = 1;
    sparkLife = 0.25;
  }

  function spread(moving) {
    return def().spread * (1 + moving * 0.35);
  }

  function step(dt, moving) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    if (state.reloading > 0) {
      state.reloading -= dt;
      if (state.reloading <= 0) {
        const w = def();
        const need = w.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
    state.kick = Math.max(0, state.kick - dt * 7);
    state.flash = Math.max(0, state.flash - dt * 14);
    flashMat.opacity = state.flash * 0.9;
    flashLight.intensity = state.flash * 14;
    state.bobPhase += dt * (2 + moving * 1.6);
    const bob = Math.sin(state.bobPhase * 2) * 0.008 * Math.min(1, moving / 4);
    gun.position.set(0.26, -0.24 + bob, -0.5 + state.kick * 0.06);
    gun.rotation.x = state.kick * 0.09;
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.line.material.opacity = 0;
      }
    }
    if (sparkLife > 0) {
      sparkLife -= dt;
      sparks.material.opacity = Math.max(0, sparkLife / 0.25);
    }
  }

  return {
    state, def, equip, refill, ready, takeRound, reload, fireVisual, spread, step,
  };
}
