// Procedural canvas textures: the whole game's art is generated here at boot, so the
// game ships no image files and loads nothing over the network. Each texture is a small
// canvas painted with noise, ribs and wear, then handed to three.js as a CanvasTexture
// with repeat wrapping. Night port: dark asphalt with painted lane lines, corrugated
// container steel, wet concrete, hazard chevrons and big site letters.
import * as THREE from 'three';

function canvasTexture(size, painter, repeat = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  painter(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function speckle(ctx, size, base, flecks, count, alpha) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = flecks[i % flecks.length];
    ctx.globalAlpha = alpha * (0.4 + Math.random() * 0.6);
    const s = 1 + Math.random() * 3;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  ctx.globalAlpha = 1;
}

function ribs(ctx, size, step, colour, width) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  for (let x = 0; x <= size; x += step) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, size);
    ctx.stroke();
  }
}

export function makeTextures() {
  // Wet asphalt: dark, with faint lane paint and puddle sheen patches.
  const ground = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#232830', ['#2b3038', '#1b1f26', '#31363f', '#3a4048'], 2400, 0.5);
    ctx.strokeStyle = 'rgba(240,168,48,0.55)';
    ctx.lineWidth = 4;
    ctx.setLineDash([26, 22]);
    ctx.beginPath(); ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(157,184,217,0.10)';
    for (let i = 0; i < 9; i += 1) {
      ctx.beginPath();
      ctx.ellipse(Math.random() * s, Math.random() * s, 14 + Math.random() * 26, 8 + Math.random() * 14, Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 8);

  const concrete = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#3a4048', ['#454c56', '#2b3038', '#4d545f', '#232830'], 2200, 0.45);
    ribs(ctx, s, 64, 'rgba(0,0,0,0.28)', 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 14; i += 1) {
      ctx.fillRect(Math.random() * s, Math.random() * s, 20 + Math.random() * 50, 3 + Math.random() * 8);
    }
  }, 2);

  const concreteDark = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#2b3038', ['#353b45', '#1f232a', '#3a4048'], 2000, 0.5);
    ribs(ctx, s, 85, 'rgba(0,0,0,0.3)', 2);
  }, 2);

  function containerTexture(base, rib) {
    return canvasTexture(256, (ctx, s) => {
      speckle(ctx, s, base, ['rgba(0,0,0,0.25)', 'rgba(255,255,255,0.07)', 'rgba(0,0,0,0.4)'], 1600, 0.4);
      ribs(ctx, s, 24, rib, 5);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, s, 10);
      ctx.fillRect(0, s - 10, s, 10);
      // stencilled number, like a real container
      ctx.fillStyle = 'rgba(232,236,242,0.5)';
      ctx.font = 'bold 26px ui-monospace, monospace';
      ctx.fillText('SLTU ' + String(100 + Math.floor(Math.random() * 800)), 14, 46);
    }, 1);
  }

  const hazard = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#d8b13a';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#0a0e16';
    for (let x = -s; x < s * 2; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, s);
      ctx.lineTo(x + 16, 0);
      ctx.lineTo(x + 32, 0);
      ctx.lineTo(x + 16, s);
      ctx.closePath();
      ctx.fill();
    }
  }, 1);

  const siteMark = (letter, colour) => canvasTexture(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = colour;
    ctx.font = 'bold 190px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, s / 2, s / 2 + 8);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, s - 28, s - 28);
  }, 1);

  // Water: dark with moon glitter streaks.
  const water = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#0d2233', ['#122c42', '#0a1a28', '#16344a'], 1800, 0.5);
    ctx.strokeStyle = 'rgba(157,184,217,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 22; i += 1) {
      const y = Math.random() * s;
      ctx.beginPath();
      ctx.moveTo(Math.random() * s, y);
      ctx.lineTo(Math.random() * s + 30, y);
      ctx.stroke();
    }
  }, 6);

  return {
    ground,
    concrete,
    concreteDark,
    rust: containerTexture('#8a4a30', 'rgba(0,0,0,0.35)'),
    ochre: containerTexture('#a87c2e', 'rgba(0,0,0,0.3)'),
    teal: containerTexture('#1f6f6a', 'rgba(0,0,0,0.3)'),
    navy: containerTexture('#27435e', 'rgba(0,0,0,0.3)'),
    steel: containerTexture('#6b7683', 'rgba(0,0,0,0.25)'),
    hazard,
    water,
    siteA: siteMark('A', '#f0a830'),
    siteB: siteMark('B', '#2e9f96'),
  };
}
