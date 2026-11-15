// Procedural canvas textures: the whole game's art is generated here at boot, so the
// game ships no image files and loads nothing over the network. Each texture is a small
// canvas painted with noise, panel lines and wear, then handed to three.js as a
// CanvasTexture with repeat wrapping.
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

function panelLines(ctx, size, step, colour, width) {
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
  const ground = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#3a352e', ['#453f35', '#2e2a24', '#4d463a', '#57503f'], 2600, 0.5);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    // expansion joints
    for (let i = 0; i <= s; i += 64) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
    }
    // tyre marks
    ctx.strokeStyle = 'rgba(20,18,14,0.25)';
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.bezierCurveTo(60, 90, 30, 170, 90, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(150, 0); ctx.bezierCurveTo(190, 100, 160, 180, 220, 256); ctx.stroke();
  }, 8);

  const concrete = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#6b655a', ['#7a7367', '#5b554b', '#847d6e', '#4a453d'], 2200, 0.45);
    panelLines(ctx, s, 64, 'rgba(0,0,0,0.28)', 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 14; i += 1) {
      ctx.fillRect(Math.random() * s, Math.random() * s, 20 + Math.random() * 50, 3 + Math.random() * 8);
    }
  }, 2);

  const concreteDark = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#4a453d', ['#57503f', '#3a352e', '#5d564a'], 2000, 0.5);
    panelLines(ctx, s, 85, 'rgba(0,0,0,0.3)', 2);
  }, 2);

  function containerTexture(base, rib) {
    return canvasTexture(256, (ctx, s) => {
      speckle(ctx, s, base, ['rgba(0,0,0,0.25)', 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.4)'], 1600, 0.4);
      panelLines(ctx, s, 32, rib, 5);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, s, 10);
      ctx.fillRect(0, s - 10, s, 10);
    }, 1);
  }

  const hazard = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#d8b13a';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#191512';
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
    ctx.fillStyle = 'rgba(0,0,0,0)';
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

  return {
    ground,
    concrete,
    concreteDark,
    rust: containerTexture('#8a4b2a', 'rgba(0,0,0,0.35)'),
    ochre: containerTexture('#b07f2e', 'rgba(0,0,0,0.3)'),
    teal: containerTexture('#2e7f7a', 'rgba(0,0,0,0.3)'),
    steel: containerTexture('#7d838a', 'rgba(0,0,0,0.25)'),
    hazard,
    siteA: siteMark('A', '#f0a830'),
    siteB: siteMark('B', '#2e9f96'),
  };
}
