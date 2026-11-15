// The match: rounds, the economy, and the spike. A round is a buy phase, a live
// phase and a short banner, then the next round. Vanguard wins a round by eliminating
// Sentinel or detonating the spike; Sentinel wins by elimination, by running the
// clock out, or by defusing. First to 5 rounds takes the match, at most 9 rounds.
// The economy is Counter-Strike-shaped: a win pays $3,250, a loss pays more the
// longer the streak runs, kills pay $300, and the shop sells guns, armour and the
// two grenades — a flash for $200, a smoke for $300.
import * as THREE from 'three';

export const BUY_SECONDS = 15;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 5;
export const SPIKE_FUSE = 35;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;
export const FLASH_PRICE = 200;
export const SMOKE_PRICE = 300;

export function createMatch(deps) {
  const { hud, audio } = deps;
  const state = {
    phase: 'buy', // buy | live | ended | match
    round: 1,
    scoreV: 0,
    scoreS: 0,
    money: 800,
    lossStreak: 0,
    timeLeft: BUY_SECONDS,
    roundHistory: [], // 'W' | 'L' per finished round, for the HUD dots
    spike: { status: 'carried', site: null, position: new THREE.Vector3(), timer: 0, carrier: 'player' },
  };

  function setPhase(phase, seconds) {
    state.phase = phase;
    state.timeLeft = seconds;
    hud.setTimer(seconds);
  }

  function startMatch() {
    state.round = 1;
    state.scoreV = 0;
    state.scoreS = 0;
    state.money = 800;
    state.lossStreak = 0;
    state.roundHistory = [];
    state.spike = { status: 'carried', site: null, position: new THREE.Vector3(), timer: 0, carrier: 'player' };
    hud.setScore(0, 0);
    hud.setMoney(800);
    hud.setSpike(null);
    hud.setRoundHistory([]);
    setPhase('buy', BUY_SECONDS);
    hud.banner('ROUND 1', 'Buy phase — press B to open the shop', true);
  }

  function startRound() {
    state.spike = { status: 'carried', site: null, position: new THREE.Vector3(), timer: 0, carrier: 'player' };
    hud.setSpike(null);
    setPhase('buy', BUY_SECONDS);
    hud.banner(`ROUND ${state.round}`, 'Buy phase — press B to open the shop', true);
  }

  function endRound(winner, reason) {
    if (state.phase === 'ended' || state.phase === 'match') return;
    const won = winner === 'vanguard';
    if (won) {
      state.scoreV += 1;
      state.money += 3250;
      state.lossStreak = 0;
      state.roundHistory.push('W');
      audio.roundWin();
    } else {
      state.scoreS += 1;
      state.lossStreak += 1;
      state.money += Math.min(2900, 1400 + state.lossStreak * 500);
      state.roundHistory.push('L');
      audio.roundLose();
    }
    hud.setScore(state.scoreV, state.scoreS);
    hud.setMoney(state.money);
    hud.setSpike(null);
    hud.setRoundHistory(state.roundHistory);
    setPhase('ended', 4);
    const reasonText = {
      elimination: won ? 'Sentinel team eliminated' : 'Vanguard team eliminated',
      detonation: 'Spike detonated at Site ' + state.spike.site,
      defuse: 'Spike defused',
      time: 'Time expired — Sentinel holds the sites',
    }[reason] ?? reason;
    hud.banner(
      won ? 'ROUND WON' : 'ROUND LOST',
      `Round ${state.round} · ${reasonText}`,
      won,
    );
    deps.onRoundEnd(winner, reason);
  }

  function plantSpike(site, position) {
    state.spike.status = 'planted';
    state.spike.site = site;
    state.spike.position.copy(position);
    state.spike.carrier = null;
    state.spike.timer = SPIKE_FUSE;
    audio.plant();
    hud.banner('SPIKE PLANTED', `Site ${site} — ${SPIKE_FUSE}s to detonation`, true);
    deps.onSpikePlanted(site);
  }

  function defuseSpike() {
    state.spike.status = 'defused';
    audio.beep();
    endRound('sentinel', 'defuse');
  }

  function dropSpike(position) {
    if (state.spike.status !== 'carried') return;
    state.spike.status = 'dropped';
    state.spike.position.copy(position);
    state.spike.carrier = null;
  }

  function addKillReward() {
    state.money += 300;
    hud.setMoney(state.money);
  }

  function addPlantReward() {
    state.money += 300;
    hud.setMoney(state.money);
  }

  function buy(item, price) {
    if (state.phase !== 'buy' || state.money < price) return false;
    state.money -= price;
    hud.setMoney(state.money);
    return true;
  }

  function step(dt) {
    if (state.phase === 'buy' || state.phase === 'live') {
      state.timeLeft -= dt;
      hud.setTimer(state.timeLeft);
      if (state.phase === 'buy' && state.timeLeft <= 0) {
        setPhase('live', ROUND_SECONDS);
        hud.banner('GO GO GO', 'Round live — plant the spike or eliminate Sentinel', true);
        audio.horn();
        deps.onRoundLive();
      } else if (state.phase === 'live' && state.timeLeft <= 0) {
        endRound('sentinel', 'time');
      }
    } else if (state.phase === 'ended') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        if (state.scoreV >= WIN_ROUNDS || state.scoreS >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
          setPhase('match', 0);
          const won = state.scoreV > state.scoreS;
          deps.onMatchEnd(won);
        } else {
          state.round += 1;
          deps.onNextRound();
          startRound();
        }
      }
    }
    if (state.spike.status === 'planted') {
      state.spike.timer -= dt;
      hud.setSpike(state.spike.timer);
      if (Math.ceil(state.spike.timer * 2) !== Math.ceil((state.spike.timer + dt) * 2)) {
        if (state.spike.timer < 10) audio.beep();
      }
      if (state.spike.timer <= 0) {
        audio.explosion();
        endRound('vanguard', 'detonation');
      }
    }
  }

  return {
    state, startMatch, startRound, endRound, plantSpike, defuseSpike, dropSpike,
    addKillReward, addPlantReward, buy, step,
  };
}
