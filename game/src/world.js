// Meridian Yard: a 64 x 46 m industrial yard at dusk. Vanguard spawns south, Sentinel
// spawns north. Site A "Crane" sits west, Site B "Depot" east, joined by Mid lane and two
// side lanes. Every box is a collider for movement and a surface a bullet stops on.
// The waypoint graph at the bottom is what the bots navigate on.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeTextures } from './textures.js';

export const SITES = {
  A: { name: 'A', label: 'CRANE', center: new THREE.Vector3(-24, 0, -13), radius: 5.5 },
  B: { name: 'B', label: 'DEPOT', center: new THREE.Vector3(24, 0, -13), radius: 5.5 },
};

export const SPAWNS = {
  vanguard: [
    [-4, 19], [-1.5, 20], [1, 19], [3.5, 20], [0, 17.5],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  sentinel: [
    [-4, -19], [-1.5, -20], [1, -19], [3.5, -20], [0, -17.5],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
};

// Waypoints the bots walk on: id, position, neighbours. Lanes run spawn -> mid -> sites.
export const WAYPOINTS = [
  { id: 0, p: [0, 18], n: [1, 2, 3] }, // vanguard spawn
  { id: 1, p: [-12, 12], n: [0, 4, 6] },
  { id: 2, p: [0, 10], n: [0, 5, 6] }, // mid south
  { id: 3, p: [12, 12], n: [0, 5, 7] },
  { id: 4, p: [-20, 2], n: [1, 6, 8] },
  { id: 5, p: [0, 0], n: [2, 4, 6, 7] }, // mid
  { id: 6, p: [-8, -2], n: [2, 4, 5, 9] },
  { id: 7, p: [20, 2], n: [3, 5, 10] },
  { id: 8, p: [-24, -8], n: [4, 9, 11] }, // A approach
  { id: 9, p: [-12, -10], n: [6, 8, 12] },
  { id: 10, p: [24, -8], n: [7, 11, 13] }, // B approach
  { id: 11, p: [12, -10], n: [9, 10, 12] },
  { id: 12, p: [0, -18], n: [9, 11, 14] }, // sentinel spawn
  { id: 13, p: [-24, -14], n: [8, 14] }, // site A
  { id: 14, p: [24, -14], n: [10, 13] }, // site B
  { id: 15, p: [-28, 6], n: [4, 8] }, // west flank
  { id: 16, p: [28, 6], n: [7, 10] }, // east flank
].map((w) => ({ ...w, p: new THREE.Vector3(w.p[0], 0, w.p[1]) }));

export function createWorld(scene) {
  const textures = makeTextures();
  const group = new THREE.Group();
  scene.add(group);

  const mat = (texture, colour, rough = 0.9, metal = 0.05) => new THREE.MeshStandardMaterial({
    map: texture ?? null, color: new THREE.Color(colour), roughness: rough, metalness: metal,
  });
  const materials = {
    ground: mat(textures.ground, '#ffffff', 0.95),
    concrete: mat(textures.concrete, '#ffffff', 0.92),
    concreteDark: mat(textures.concreteDark, '#ffffff', 0.94),
    rust: mat(textures.rust, '#ffffff', 0.85, 0.15),
    ochre: mat(textures.ochre, '#ffffff', 0.85, 0.15),
    teal: mat(textures.teal, '#ffffff', 0.85, 0.15),
    steel: mat(textures.steel, '#ffffff', 0.6, 0.55),
    amber: mat(null, PALETTE.amber, 0.5, 0.3),
    spike: mat(null, PALETTE.spike, 0.4, 0.2),
  };

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, { collide = true, shoot = true, ry = 0 } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    if (shoot) shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter: 64 x 46 m, 5 m walls, open sky.
  box(64.4, 0.4, 46.4, 0, -0.2, 0, 'ground', { collide: false });
  box(0.6, 5, 46.4, -32.2, 2.5, 0, 'concrete');
  box(0.6, 5, 46.4, 32.2, 2.5, 0, 'concrete');
  box(64.4, 5, 0.6, 0, 2.5, -23.2, 'concreteDark');
  box(64.4, 5, 0.6, 0, 2.5, 23.2, 'concrete');

  // Site A "Crane": a gantry crane over the west yard, containers stacked below it.
  box(1.2, 9, 1.2, -28, 4.5, -16, 'steel');
  box(1.2, 9, 1.2, -20, 4.5, -16, 'steel');
  box(10, 1.4, 1.6, -24, 9.2, -16, 'steel');
  box(2.2, 1.2, 1.2, -26, 7.6, -16, 'amber'); // crane hook block
  box(6, 2.6, 2.6, -27, 1.3, -11, 'rust');
  box(6, 2.6, 2.6, -27, 3.9, -11, 'ochre');
  box(3, 1.2, 3, -19, 0.6, -9, 'teal');

  // Site B "Depot": a low warehouse wall with a loading dock and stacked containers.
  box(12, 4.2, 0.8, 24, 2.1, -20.5, 'concreteDark');
  box(6, 2.6, 2.6, 20, 1.3, -16, 'teal');
  box(6, 2.6, 2.6, 26.5, 1.3, -16, 'rust');
  box(6, 2.6, 2.6, 23, 3.9, -16, 'ochre');
  box(4, 1.2, 2.4, 28, 0.6, -9, 'steel');

  // Mid: a container stack and a low wall splitting the lane, plus crates.
  box(6, 2.6, 2.6, -3, 1.3, 2, 'rust');
  box(6, 2.6, 2.6, -3, 3.9, 2, 'teal');
  box(4.5, 1.1, 1.2, 5, 0.55, -2, 'concreteDark');
  box(1.2, 1.1, 1.2, -10, 0.55, -4, 'ochre');
  box(1.2, 1.1, 1.2, 10, 0.55, 6, 'rust');
  box(2.4, 1.2, 2.4, -14, 0.6, 8, 'teal');
  box(2.4, 1.2, 2.4, 14, 0.6, -6, 'ochre');
  box(1.2, 1.1, 1.2, 0, 0.55, -14, 'steel');

  // Side lanes: barrels and crates as crouch cover.
  for (const [x, z, m] of [[-18, 14, 'rust'], [-8, 14, 'teal'], [8, 14, 'ochre'], [18, 14, 'rust'],
    [-18, -4, 'teal'], [18, -4, 'rust'], [-28, 2, 'ochre'], [28, 2, 'teal']]) {
    box(1.3, 1.2, 1.3, x, 0.6, z, m);
  }
  // Barrels (cylinders, colliders approximated by a box).
  const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12);
  for (const [x, z] of [[-6, 6], [6, -8], [-22, -2], [22, 10], [2, 16]]) {
    const barrel = new THREE.Mesh(barrelGeo, materials.steel);
    barrel.position.set(x, 0.55, z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    group.add(barrel);
    colliders.push(new THREE.Box3().setFromObject(barrel));
    shootables.push(barrel);
  }

  // Site markers: a painted letter on the ground and a hazard border at each site.
  for (const site of Object.values(SITES)) {
    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshBasicMaterial({ map: site.name === 'A' ? textures.siteA : textures.siteB, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(site.center.x, 0.02, site.center.z);
    group.add(mark);
    const border = new THREE.Mesh(
      new THREE.PlaneGeometry(site.radius * 2, site.radius * 2),
      new THREE.MeshBasicMaterial({ map: textures.hazard, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    border.rotation.x = -Math.PI / 2;
    border.position.set(site.center.x, 0.015, site.center.z);
    group.add(border);
  }

  // Distant skyline silhouettes beyond the walls, so the yard never looks empty.
  const skyline = new THREE.Group();
  for (let i = 0; i < 14; i += 1) {
    const w = 6 + Math.random() * 10;
    const h = 8 + Math.random() * 16;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 4),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#241d18'), roughness: 1 }),
    );
    const angle = (i / 14) * Math.PI * 2;
    m.position.set(Math.cos(angle) * 58, h / 2 - 1, Math.sin(angle) * 52);
    skyline.add(m);
  }
  scene.add(skyline);

  // Dusk light: a low warm sun, a cool sky fill, and a soft hemisphere.
  scene.background = new THREE.Color(PALETTE.canvas);
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 40, 110);
  scene.add(new THREE.HemisphereLight(new THREE.Color('#8a7a68'), new THREE.Color('#241d18'), 1.15));
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb35c'), 2.8);
  sun.position.set(-28, 26, 18);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5c7a8a'), 0.5);
  fill.position.set(24, 14, -18);
  scene.add(fill);

  return { colliders, shootables, group, textures };
}
