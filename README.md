# threejs-fps-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Abay26/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Abay26/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

Saltline Terminal is a round-based tactical FPS in three.js: two teams of five fight short rounds in a container port at night — plant the spike at Site A (Dry Dock) or Site B (Fuel Pier), or eliminate the other team. Money between rounds buys rifles, an SMG, a shotgun, a scoped sniper and Kevlar, plus flashbang and smoke grenades that really blind and really block sightlines. Bots patrol, hold sites, investigate gunfire, strafe in duels, retake planted sites in pairs, and smoke the doorway before they push in. A bot wedged on a container face sidesteps free and re-plans instead of standing there until the fuse runs out; once the spike is down the attackers spread to post-plant off-angles while the retake splits into one defuser and covers holding the hall approaches; two deaths on a push rotate the whole attack to the other site; a save round is a team decision from the average wallet; a site-holder's hit call rotates the mid rover to reinforce; duels are fought planted at range and strafing up close, with burst discipline by distance and a role aim skill; and the last bot alive plays a clutch — faster reactions, straight for the defuse. The carrier plants the moment he is inside the site instead of duelling on it, pushes instead of taking long duels, and the spike's recovery names the site the whole team plays for; the entry flash goes off at the site door, not from spawn, and a B rush pushes as one pack with two flashes.

Gunplay is built around stopping to aim: spread blooms with sustained fire, movement and jumping punish accuracy, crouching and standing still reward it, and damage falls off past each gun's effective range. Headshots pay double-ish. The map is a 72×52 m night terminal — Crane Row down the middle, flank lanes past the container stacks, a warehouse hall in the north centre, and the harbour glittering beyond the wall.

## Run it

```sh
node serve.ts
# open http://localhost:8080 — click to play
# WASD move, Shift sprint, Ctrl crouch, Space jump, mouse look
# Click fire, R reload, right-click scope (Mastiff), E plant/defuse (hold)
# G throw grenade, Q switch flash/smoke, B buy menu, M mute
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=qw56w9dq&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
