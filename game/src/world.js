// Saltline Terminal: a 72 x 52 m container port at night. Vanguard spawns south at
// the gatehouse, Sentinel spawns north by the harbour wall. Site A "Dry Dock" sits
// west under the gantry crane, Site B "Fuel Pier" east by the tanks, joined by Crane
// Row down the middle and two flank lanes past the container stacks. A warehouse
// hall — columns, hanging lamps, no roof but the fog — covers the north centre, and
// beyond the harbour wall the water glints under the moon. Every box is a collider
// for movement and a surface a bullet stops on. The waypoint graph at the bottom is
// what the bots navigate on.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeTextures } from './textures.js';

export const MAP = { halfW: 36, halfH: 26 };

export const SITES = {
  A: { name: 'A', label: 'DRY DOCK', center: new THREE.Vector3(-28, 0, -14), radius: 5.5 },
  B: { name: 'B', label: 'FUEL PIER', center: new THREE.Vector3(28, 0, -14), radius: 5.5 },
};

export const SPAWNS = {
  vanguard: [
    [-4, 22], [-1.5, 23], [1, 22], [3.5, 23], [0, 20.5],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  sentinel: [
    [-4, -22], [-1.5, -23], [1, -22], [3.5, -23], [0, -20.5],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
};

// Waypoints the bots walk on: id, position, neighbours. Lanes run spawn -> mid -> sites,
// with flank lanes hugging the west and east walls.
export const WAYPOINTS = [
  { id: 0, p: [0, 21], n: [1, 2, 3] }, // vanguard spawn
  { id: 1, p: [-14, 14], n: [0, 4, 6] },
  { id: 2, p: [0, 12], n: [0, 5, 6] }, // crane row south
  { id: 3, p: [14, 14], n: [0, 5, 7] },
  { id: 4, p: [-24, 4], n: [1, 6, 8] }, // west flank
  { id: 5, p: [0, 0], n: [2, 4, 6, 7] }, // crane row
  { id: 6, p: [-10, -2], n: [2, 4, 5, 9] },
  { id: 7, p: [24, 4], n: [3, 5, 10] }, // east flank
  { id: 8, p: [-28, -6], n: [4, 9, 11] }, // A approach
  { id: 9, p: [-14, -10], n: [6, 8, 12] },
  { id: 10, p: [28, -6], n: [7, 11, 13] }, // B approach
  { id: 11, p: [14, -10], n: [9, 10, 12] },
  { id: 12, p: [0, -20], n: [9, 11, 14] }, // sentinel spawn
  { id: 13, p: [-28, -15], n: [8, 14] }, // site A
  { id: 14, p: [28, -15], n: [10, 13] }, // site B
  { id: 15, p: [-32, 8], n: [4, 8] }, // west wall lane
  { id: 16, p: [32, 8], n: [7, 10] }, // east wall lane
  { id: 17, p: [-6, -14], n: [6, 9, 12] }, // hall west
  { id: 18, p: [6, -14], n: [7, 11, 12] }, // hall east
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
    navy: mat(textures.navy, '#ffffff', 0.85, 0.15),
    steel: mat(textures.steel, '#ffffff', 0.6, 0.55),
    amber: mat(null, PALETTE.amber, 0.5, 0.3),
    sodium: mat(null, PALETTE.sodium, 0.4, 0.2),
    water: mat(textures.water, '#ffffff', 0.25, 0.6),
  };

  const colliders = [];
  const shootables = [];
  const lamps = []; // { position, colour } — lit by createWorld's point lights

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

  // Ground and perimeter: 72 x 52 m, 5.5 m walls, open night sky.
  box(72.4, 0.4, 52.4, 0, -0.2, 0, 'ground', { collide: false });
  box(0.6, 5.5, 52.4, -36.2, 2.75, 0, 'concrete');
  box(0.6, 5.5, 52.4, 36.2, 2.75, 0, 'concrete');
  box(72.4, 5.5, 0.6, 0, 2.75, -26.2, 'concreteDark');
  box(72.4, 5.5, 0.6, 0, 2.75, 26.2, 'concrete');

  // Site A "Dry Dock": a gantry crane over the west yard, containers stacked below.
  box(1.4, 11, 1.4, -32, 5.5, -18, 'steel');
  box(1.4, 11, 1.4, -23, 5.5, -18, 'steel');
  box(11, 1.6, 1.8, -27.5, 11.2, -18, 'steel');
  box(2.4, 1.4, 1.4, -29, 9.4, -18, 'amber'); // crane hook block
  box(6, 2.6, 2.6, -31, 1.3, -12, 'rust');
  box(6, 2.6, 2.6, -31, 3.9, -12, 'ochre');
  box(6, 2.6, 2.6, -24, 1.3, -18, 'navy');
  box(3, 1.2, 3, -21, 0.6, -10, 'teal');

  // Site B "Fuel Pier": two storage tanks and a loading dock.
  const tankGeo = new THREE.CylinderGeometry(2.2, 2.2, 4.5, 16);
  for (const [x, z, m] of [[30, -20, 'steel'], [24, -21, 'rust']]) {
    const tank = new THREE.Mesh(tankGeo, materials[m]);
    tank.position.set(x, 2.25, z);
    tank.castShadow = true;
    tank.receiveShadow = true;
    group.add(tank);
    colliders.push(new THREE.Box3().setFromObject(tank));
    shootables.push(tank);
  }
  box(12, 4.2, 0.8, 28, 2.1, -23.5, 'concreteDark');
  box(6, 2.6, 2.6, 22, 1.3, -17, 'teal');
  box(6, 2.6, 2.6, 31, 1.3, -17, 'ochre');
  box(4, 1.2, 2.4, 26, 0.6, -9, 'steel');

  // Crane Row (mid): a container stack and a low wall splitting the lane.
  box(6, 2.6, 2.6, -3, 1.3, 2, 'rust');
  box(6, 2.6, 2.6, -3, 3.9, 2, 'navy');
  box(6, 2.6, 2.6, 3, 1.3, -4, 'teal');
  box(4.5, 1.1, 1.2, 6, 0.55, 4, 'concreteDark');
  box(1.2, 1.1, 1.2, -12, 0.55, -4, 'ochre');
  box(1.2, 1.1, 1.2, 12, 0.55, 6, 'rust');
  box(2.4, 1.2, 2.4, -16, 0.6, 8, 'teal');
  box(2.4, 1.2, 2.4, 16, 0.6, -6, 'ochre');
  box(1.2, 1.1, 1.2, 0, 0.55, -16, 'steel');

  // Warehouse hall (north centre): columns, a high beam grid and hanging lamps.
  for (const [x, z] of [[-10, -12], [10, -12], [-10, -18], [10, -18], [0, -12], [0, -18]]) {
    box(0.9, 7, 0.9, x, 3.5, z, 'steel');
  }
  box(22, 0.7, 0.7, 0, 7.2, -12, 'steel');
  box(22, 0.7, 0.7, 0, 7.2, -18, 'steel');
  box(0.7, 0.7, 6.7, -10, 7.2, -15, 'steel');
  box(0.7, 0.7, 6.7, 10, 7.2, -15, 'steel');
  box(0.7, 0.7, 6.7, 0, 7.2, -15, 'steel');

  // Side lanes: crates as crouch cover, and pipes along the walls.
  for (const [x, z, m] of [[-20, 16, 'rust'], [-9, 16, 'teal'], [9, 16, 'ochre'], [20, 16, 'rust'],
    [-20, -4, 'teal'], [20, -4, 'rust'], [-32, 4, 'ochre'], [32, 4, 'teal']]) {
    box(1.3, 1.2, 1.3, x, 0.6, z, m);
  }
  const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12);
  for (const [x, z] of [[-7, 8], [7, -9], [-25, -2], [25, 12], [2, 18], [-2, -8]]) {
    const barrel = new THREE.Mesh(barrelGeo, materials.steel);
    barrel.position.set(x, 0.55, z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    group.add(barrel);
    colliders.push(new THREE.Box3().setFromObject(barrel));
    shootables.push(barrel);
  }
  // Pipes along the east and west walls.
  box(0.5, 0.5, 40, -35.6, 1.2, 0, 'steel', { collide: false });
  box(0.5, 0.5, 40, 35.6, 1.2, 0, 'steel', { collide: false });

  // Site markers: a painted letter on the ground and a hazard border at each site.
  for (const site of Object.values(SITES)) {
    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshBasicMaterial({ map: site.name === 'A' ? textures.siteA : textures.siteB, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(site.center.x, 0.02, site.center.z);
    group.add(mark);
    const border = new THREE.Mesh(
      new THREE.PlaneGeometry(site.radius * 2, site.radius * 2),
      new THREE.MeshBasicMaterial({ map: textures.hazard, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    border.rotation.x = -Math.PI / 2;
    border.position.set(site.center.x, 0.015, site.center.z);
    group.add(border);
  }

  // Sodium lamp posts: a pole, a glowing head, and a warm point light. Six lights
  // is the whole night budget — everything else is moon and hemisphere.
  const lampHeadGeo = new THREE.BoxGeometry(0.5, 0.25, 0.9);
  for (const [x, z] of [[-14, 8], [14, 8], [-14, -8], [14, -8], [0, 16], [0, -16]]) {
    box(0.25, 4.6, 0.25, x, 2.3, z, 'steel');
    const head = new THREE.Mesh(lampHeadGeo, materials.sodium);
    head.position.set(x, 4.7, z);
    group.add(head);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.sodium), 30, 28, 1.8);
    light.position.set(x, 4.5, z);
    scene.add(light);
    lamps.push({ position: new THREE.Vector3(x, 4.7, z) });
  }

  // Harbour backdrop: water beyond the north wall, distant gantry cranes, and a
  // blinking red beacon on the tallest one.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(220, 60), materials.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.4, -58);
  scene.add(water);
  const skyline = new THREE.Group();
  for (let i = 0; i < 10; i += 1) {
    const w = 5 + Math.random() * 9;
    const h = 10 + Math.random() * 20;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 4),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#0d1420'), roughness: 1 }),
    );
    const angle = Math.PI + (i / 10) * Math.PI * 0.6 - Math.PI * 0.3;
    m.position.set(Math.cos(angle) * 70, h / 2 - 1, -30 - Math.sin(angle) * 30);
    skyline.add(m);
  }
  scene.add(skyline);
  // Distant gantry cranes on the harbour.
  for (const x of [-40, -8, 24]) {
    const crane = new THREE.Group();
    const legMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#131a26') });
    for (const lx of [-4, 4]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 22, 1.2), legMat);
      leg.position.set(lx, 11, 0);
      crane.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(26, 1.4, 1.4), legMat);
    beam.position.set(0, 22, 0);
    crane.add(beam);
    crane.position.set(x, 0, -48);
    scene.add(crane);
  }
  const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a1a') });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), beaconMat);
  beacon.position.set(-8, 24, -48);
  scene.add(beacon);

  // Stars: a thousand faint points over the yard.
  const starCount = 900;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const e = 0.15 + Math.random() * 1.2;
    const r = 160;
    starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
    starPos[i * 3 + 1] = Math.sin(e) * r;
    starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcdd8ea, size: 0.7, sizeAttenuation: false }));
  scene.add(stars);

  // Night light: a cold moon low in the east, a dim blue sky fill, and a faint
  // hemisphere so the dark side of a container is never pure black.
  scene.background = new THREE.Color(PALETTE.canvas);
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 45, 130);
  scene.add(new THREE.HemisphereLight(new THREE.Color('#4a5a75'), new THREE.Color('#0d0f14'), 1.05));
  const moon = new THREE.DirectionalLight(new THREE.Color(PALETTE.moon), 1.8);
  moon.position.set(40, 34, -20);
  moon.target.position.set(-6, 0, 6);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -45;
  moon.shadow.camera.right = 45;
  moon.shadow.camera.top = 45;
  moon.shadow.camera.bottom = -45;
  moon.shadow.camera.far = 130;
  moon.shadow.bias = -0.0005;
  scene.add(moon, moon.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#3d5a7a'), 0.35);
  fill.position.set(-30, 16, 24);
  scene.add(fill);

  return { colliders, shootables, group, textures, lamps, beacon };
}
