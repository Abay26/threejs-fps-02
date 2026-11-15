// The HUD is plain DOM over the canvas: health and armour bars, ammunition, money, the
// round timer and team score, alive pips, a kill feed, a 2D minimap drawn from the
// world's colliders, the buy menu, and the round banners. All of it is updated through
// these setters so the game logic never touches the DOM directly.
import { PALETTE } from './palette.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    healthNum: $('health-num'), healthBar: $('health-bar'), armorNum: $('armor-num'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    money: $('money'), timer: $('timer'), scoreV: $('score-v'), scoreS: $('score-s'),
    aliveV: $('alive-v'), aliveS: $('alive-s'), killfeed: $('killfeed'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    buy: $('buy'), buyMoney: $('buy-money'), damage: $('damage'),
    plant: $('plant'), plantLabel: $('plant-label'), plantFill: $('plant-fill'),
    spike: $('spike'), spikeTimer: $('spike-timer'), minimap: $('minimap'),
  };
  const mapCtx = els.minimap.getContext('2d');
  let hitTimer = null;
  let bannerTimer = null;
  let playHandler = null;

  els.play.addEventListener('click', () => {
    if (playHandler) playHandler();
  });

  function showOverlay(kind, data = {}) {
    els.overlay.hidden = false;
    if (kind === 'start') {
      els.overlayTitle.textContent = 'MERIDIAN YARD';
      els.overlayCopy.textContent = 'A round-based tactical FPS. Plant the spike at A or B, or eliminate the Sentinel team. Buy between rounds — accuracy beats speed.';
      els.play.textContent = 'Click to play';
    } else if (kind === 'paused') {
      els.overlayTitle.textContent = 'Paused';
      els.overlayCopy.textContent = 'Click to jump back in.';
      els.play.textContent = 'Resume';
    } else if (kind === 'end') {
      els.overlayTitle.textContent = data.title ?? 'Round over';
      els.overlayCopy.textContent = data.copy ?? '';
      els.play.textContent = 'Play again';
    } else if (kind === 'match') {
      els.overlayTitle.textContent = data.title ?? 'Match over';
      els.overlayCopy.textContent = data.copy ?? '';
      els.play.textContent = 'Play again';
    }
  }

  function hideOverlay() { els.overlay.hidden = true; }

  function setHealth(health, armor) {
    els.healthNum.textContent = Math.ceil(health);
    els.healthBar.style.width = `${Math.max(0, health)}%`;
    els.healthBar.classList.toggle('low', health <= 30);
    els.armorNum.textContent = Math.ceil(armor);
  }

  function setAmmo(mag, reserve, name) {
    els.ammoMag.textContent = mag;
    els.ammoReserve.textContent = `/ ${reserve}`;
    els.weaponName.textContent = name;
    els.ammoMag.parentElement.classList.toggle('empty', mag === 0);
  }

  function setMoney(value) { els.money.textContent = `$${value}`; }
  function setTimer(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    els.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    els.timer.classList.toggle('low', seconds <= 10);
  }
  function setScore(v, s) { els.scoreV.textContent = v; els.scoreS.textContent = s; }
  function setAlive(v, s) {
    els.aliveV.textContent = '●'.repeat(v) + '○'.repeat(Math.max(0, 5 - v));
    els.aliveS.textContent = '●'.repeat(s) + '○'.repeat(Math.max(0, 5 - s));
  }

  function killfeed(killer, victim, headshot) {
    const line = document.createElement('div');
    line.innerHTML = `<b>${killer}</b> ${headshot ? '◉' : '✕'} <b>${victim}</b>`;
    els.killfeed.prepend(line);
    while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
    setTimeout(() => line.remove(), 6000);
  }

  function hitMarker(killed) {
    els.hitmarker.classList.add('on');
    els.hitmarker.classList.toggle('kill', killed);
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), 140);
  }

  function damageFlash() {
    els.damage.classList.add('on');
    setTimeout(() => els.damage.classList.remove('on'), 180);
  }

  function banner(title, sub, good) {
    els.bannerTitle.textContent = title;
    els.bannerSub.textContent = sub;
    els.banner.classList.toggle('good', good);
    els.banner.classList.toggle('bad', !good);
    els.banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { els.banner.hidden = true; }, 3400);
  }

  function hideBanner() {
    clearTimeout(bannerTimer);
    els.banner.hidden = true;
  }

  function setCrosshairSpread(px) {
    els.crosshair.style.setProperty('--gap', `${px}px`);
  }

  function setPlant(label, progress) {
    if (label == null) { els.plant.hidden = true; return; }
    els.plant.hidden = false;
    els.plantLabel.textContent = label;
    els.plantFill.style.width = `${Math.round(progress * 100)}%`;
  }

  function setSpike(seconds) {
    if (seconds == null) { els.spike.hidden = true; return; }
    els.spike.hidden = false;
    els.spikeTimer.textContent = seconds.toFixed(1);
  }

  function showBuy(money, items, owned) {
    els.buy.hidden = false;
    els.buyMoney.textContent = `$${money}`;
    const list = $('buy-items');
    list.innerHTML = '';
    for (const item of items) {
      // A div, not a button: buttons ignore grid layout in Chrome and the columns
      // collapse on top of each other.
      const row = document.createElement('div');
      row.className = 'buy-item';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      const unavailable = money < item.price || owned.has(item.id);
      if (unavailable) row.classList.add('disabled');
      row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">${owned.has(item.id) ? 'OWNED' : '$' + item.price}</span>`;
      if (!unavailable) row.addEventListener('click', () => item.buy());
      list.appendChild(row);
    }
  }
  function hideBuy() { els.buy.hidden = true; }

  // Minimap: the yard from above. Colliders are the walls and cover; dots are the
  // player (amber, with a facing wedge), teammates (amber dots), enemies (red, only
  // while they are visible to the player) and the spike (red diamond).
  function drawMinimap(colliders, player, bots, spikePos) {
    const w = 148;
    const h = 108;
    const scaleX = w / 68;
    const scaleZ = h / 50;
    const toX = (x) => (x + 34) * scaleX;
    const toY = (z) => (z + 25) * scaleZ;
    mapCtx.clearRect(0, 0, w, h);
    mapCtx.fillStyle = 'rgba(20,18,14,0.72)';
    mapCtx.fillRect(0, 0, w, h);
    mapCtx.fillStyle = '#4a453d';
    for (const c of colliders) {
      mapCtx.fillRect(toX(c.min.x), toY(c.min.z), Math.max(1, (c.max.x - c.min.x) * scaleX), Math.max(1, (c.max.z - c.min.z) * scaleZ));
    }
    mapCtx.fillStyle = PALETTE.amber;
    mapCtx.font = 'bold 11px system-ui, sans-serif';
    mapCtx.fillText('A', toX(-24) - 4, toY(-13) + 4);
    mapCtx.fillStyle = '#2e9f96';
    mapCtx.fillText('B', toX(24) - 4, toY(-13) + 4);
    if (spikePos) {
      mapCtx.fillStyle = PALETTE.spike;
      mapCtx.beginPath();
      mapCtx.moveTo(toX(spikePos.x), toY(spikePos.z) - 4);
      mapCtx.lineTo(toX(spikePos.x) + 4, toY(spikePos.z));
      mapCtx.lineTo(toX(spikePos.x), toY(spikePos.z) + 4);
      mapCtx.lineTo(toX(spikePos.x) - 4, toY(spikePos.z));
      mapCtx.fill();
    }
    for (const bot of bots) {
      if (!bot.alive) continue;
      mapCtx.fillStyle = bot.team === 'vanguard' ? PALETTE.amber : '#e2483d';
      mapCtx.beginPath();
      mapCtx.arc(toX(bot.position.x), toY(bot.position.z), 2.5, 0, Math.PI * 2);
      mapCtx.fill();
    }
    // Player wedge.
    mapCtx.save();
    mapCtx.translate(toX(player.position.x), toY(player.position.z));
    mapCtx.rotate(Math.atan2(Math.sin(player.yaw), Math.cos(player.yaw)) + Math.PI / 2);
    mapCtx.fillStyle = '#ffffff';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -6);
    mapCtx.lineTo(4, 4);
    mapCtx.lineTo(-4, 4);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.restore();
  }

  return {
    showOverlay, hideOverlay, setHealth, setAmmo, setMoney, setTimer, setScore,
    setAlive, killfeed, hitMarker, damageFlash, banner, hideBanner, setCrosshairSpread,
    setPlant, setSpike, showBuy, hideBuy, drawMinimap,
    onPlay(handler) { playHandler = handler; },
  };
}
