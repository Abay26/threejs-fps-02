// Team strategy: the match is played as a plan, not a trickle. Every round both
// teams pick a plan before the buy phase ends — Vanguard picks an attack strat,
// Sentinel picks a defensive setup — and the bots execute it together: they wait
// at spawn until the execute clock, the entry fragger flashes the site first,
// and the rest push on his flash. A team that lost the last two rounds forces a
// fast rush; a team that is up plays its default. The plan is also the economy:
// each bot buys to a tier from its own wallet (eco, force, full), so the shop is
// a team decision, not a solo one. Radio callouts are the plan talking: the
// entry calls the flash, the lurker calls the rotate, the site holder calls the
// hit. All of it is data — the bots module walks the waypoints, this module
// decides where they are going and why.
import { WEAPONS } from './weapon.js';

// Vanguard attack strats. assignments are per bot index (0..3, the four
// Vanguard bots; the player is the fifth): site, lane waypoint, execute delay
// in seconds after the round goes live, and the utility the bot throws — smoke
// on the execute clock, a flash when the entry fragger reaches the site door.
// The entry fragger is always assignments[0].
export const VANGUARD_STRATS = [
  {
    name: 'A SPLIT',
    call: 'A split — two up Crane Row, two down West Flank, flash on the site',
    assignments: [
      { site: 'A', lane: 2, delay: 4, utility: 'flash' },
      { site: 'A', lane: 2, delay: 4, utility: null },
      { site: 'A', lane: 15, delay: 6, utility: 'smoke' },
      { site: 'B', lane: 16, delay: 9, utility: null },
    ],
  },
  {
    name: 'B RUSH',
    call: 'B rush — everybody down East Flank, two flashes on the pier',
    assignments: [
      { site: 'B', lane: 3, delay: 2, utility: 'flash' },
      { site: 'B', lane: 3, delay: 2, utility: 'flash' },
      { site: 'B', lane: 7, delay: 2, utility: 'smoke' },
      { site: 'B', lane: 3, delay: 2, utility: null },
    ],
  },
  {
    name: 'MID CONTROL',
    call: 'Mid control — take Crane Row, then split to whichever site is thin',
    assignments: [
      { site: 'A', lane: 2, delay: 3, utility: null },
      { site: 'A', lane: 2, delay: 3, utility: 'flash' },
      { site: 'B', lane: 5, delay: 5, utility: null },
      { site: 'B', lane: 16, delay: 8, utility: 'smoke' },
    ],
  },
  {
    name: 'FAKE A',
    call: 'Fake A — show two at Dry Dock, then rotate the whole team to B',
    assignments: [
      { site: 'A', lane: 4, delay: 3, utility: 'flash' },
      { site: 'A', lane: 1, delay: 3, utility: null },
      { site: 'B', lane: 16, delay: 10, utility: 'smoke' },
      { site: 'B', lane: 7, delay: 10, utility: null },
    ],
  },
];

// Post-plant holds: where the attackers go once the spike is down. Nobody stands
// on the spike — each Vanguard bot takes an off-angle that watches a defuse
// approach instead: the site approach, the hall lane, and the flank. The holds
// are waypoint ids, assigned round-robin by bot index when the plant lands.
export const POST_PLANT = {
  A: [8, 9, 17],
  B: [10, 11, 18],
};

// Retake cover: where the non-defusing Sentinels hold while their teammate works
// the spike. They watch the hall approaches the attackers must come down to stop
// the defuse, instead of queuing on the spike themselves.
export const RETAKE_COVER = {
  A: [9, 17],
  B: [11, 18],
};
export const SENTINEL_SETUPS = [
  {
    name: 'STACK A',
    call: 'Stacking A — four on Dry Dock, one watching mid',
    assignments: [
      { site: 'A', lane: 13, delay: 0, utility: null },
      { site: 'A', lane: 8, delay: 0, utility: null },
      { site: 'A', lane: 9, delay: 0, utility: 'smoke' },
      { site: 'A', lane: 17, delay: 0, utility: null },
      { site: null, lane: 5, delay: 0, utility: null },
    ],
  },
  {
    name: 'STACK B',
    call: 'Stacking B — four on Fuel Pier, one watching mid',
    assignments: [
      { site: 'B', lane: 14, delay: 0, utility: null },
      { site: 'B', lane: 10, delay: 0, utility: null },
      { site: 'B', lane: 11, delay: 0, utility: 'smoke' },
      { site: 'B', lane: 18, delay: 0, utility: null },
      { site: null, lane: 5, delay: 0, utility: null },
    ],
  },
  {
    name: '2-1-2 SPREAD',
    call: 'Two-one-two — two per site, one roaming mid',
    assignments: [
      { site: 'A', lane: 13, delay: 0, utility: null },
      { site: 'A', lane: 8, delay: 0, utility: null },
      { site: null, lane: 5, delay: 0, utility: null },
      { site: 'B', lane: 14, delay: 0, utility: null },
      { site: 'B', lane: 10, delay: 0, utility: 'smoke' },
    ],
  },
  {
    name: 'RETAKE STACK',
    call: 'Retake stack — hold the hall, flood the site together on the plant',
    assignments: [
      { site: 'A', lane: 17, delay: 0, utility: null },
      { site: 'A', lane: 9, delay: 0, utility: null },
      { site: null, lane: 12, delay: 0, utility: 'flash' },
      { site: 'B', lane: 18, delay: 0, utility: null },
      { site: 'B', lane: 11, delay: 0, utility: null },
    ],
  },
];

// The economy, per bot: a wallet that grows with round wins and kills, and a
// buy tier from it. Full buy is a rifle and armour; force buy is an SMG or a
// shotgun; eco is the pistol and a saved wallet. A bot that cannot afford its
// tier drops one — a broke team plays pistols, exactly like the player does.
const TIERS = [
  { min: 3900, weapon: 'falcon', armor: 100, label: 'full buy' },
  { min: 2700, weapon: 'falcon', armor: 0, label: 'rifle, no armour' },
  { min: 1900, weapon: 'boar', armor: 0, label: 'force buy' },
  { min: 1400, weapon: 'jackal', armor: 0, label: 'force buy' },
  { min: 0, weapon: 'kestrel', armor: 0, label: 'eco' },
];

export function buyForBot(bot, forceEco = false) {
  const wallet = bot.wallet ?? 800;
  const tier = forceEco
    ? TIERS[TIERS.length - 1]
    : TIERS.find((t) => wallet >= t.min) ?? TIERS[TIERS.length - 1];
  // The AWPer keeps the Mastiff whenever the wallet stretches to it.
  const weapon = bot.role === 'awper' && wallet >= 4750 && !forceEco ? 'mastiff' : tier.weapon;
  const cost = forceEco ? 0 : WEAPONS[weapon].price + tier.armor * 6.5;
  bot.wallet = Math.max(0, wallet - cost);
  bot.armor = tier.armor;
  bot.weaponId = weapon;
  return `${bot.name} ${WEAPONS[weapon].name} · ${forceEco ? 'team eco' : tier.label}`;
}

// The team economy: a save round is a team decision, not five solo ones. If a
// team's average wallet cannot afford a force buy, the whole team ecos together
// — pistols and patience — and buys full next round. A lone broke bot buying a
// rifle while his team saves is a round thrown away.
export function planEconomy(vanguardBots, sentinelBots) {
  const avg = (team) => team.reduce((sum, b) => sum + (b.wallet ?? 800), 0) / Math.max(1, team.length);
  const vAvg = avg(vanguardBots);
  const sAvg = avg(sentinelBots);
  const vanguardEco = vAvg < 1900;
  const sentinelEco = sAvg < 1900;
  return {
    vanguardEco,
    sentinelEco,
    call: vanguardEco
      ? 'Team eco — save for next round, pistols and patience'
      : sentinelEco
        ? 'Sentinel eco — they are saving, expect a full buy next round'
        : null,
  };
}

export function planRound(round, scoreV, scoreS, random) {
  // A team on a two-round losing streak forces a fast rush; a team that is up
  // plays its default. Otherwise the pick is a weighted draw — the same round
  // never plays the same way twice.
  const vStreak = scoreS - scoreV;
  const sStreak = scoreV - scoreS;
  const pick = (list, rushIndex) => {
    if (rushIndex >= 0 && random() < 0.45) return list[rushIndex];
    return list[Math.floor(random() * list.length)];
  };
  const vanguard = pick(VANGUARD_STRATS, vStreak >= 2 ? 1 : -1);
  const sentinel = pick(SENTINEL_SETUPS, sStreak >= 2 ? 3 : -1);
  return {
    round,
    vanguard: { name: vanguard.name, call: vanguard.call, assignments: vanguard.assignments },
    sentinel: { name: sentinel.name, call: sentinel.call, assignments: sentinel.assignments },
  };
}

// Radio lines, called by the bots module at the moments that matter. Each one
// is a short sentence a teammate would actually say over comms.
export const CALLOUTS = {
  execute: (name, site) => `${name}: executing ${site} — flash out, go go go`,
  rotate: (name, site) => `${name}: rotating to ${site}`,
  hit: (name, site, count) => `${name}: ${site} hit — ${count} pushing`,
  plant: (name, site) => `${name}: spike down on ${site}, hold the post-plant`,
  retake: (name, site) => `${name}: retaking ${site}, smoke the door`,
  defuse: (name, site) => `${name}: on the spike on ${site} — cover me`,
  eco: (call) => `ECONOMY: ${call}`,
  clutch: (name, left, foes) => `${name}: last one standing — 1v${foes}, make it count`,
};
