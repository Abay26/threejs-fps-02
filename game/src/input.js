// Pointer lock, mouse look and the keyboard. The game only listens for movement while
// the pointer is locked; overlays (buy menu, banners) own the mouse the rest of the
// time. Right mouse aims the sniper's scope; G throws the selected grenade, Q cycles
// flash and smoke, and 6 / 7 select them directly.
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    lookX: 0,
    lookY: 0,
    firing: false,
    scoped: false,
    locked: false,
  };
  // Edge-triggered presses: a quick tap between two slow frames must still register,
  // so keydown queues the code and the game drains the queue once a step.
  const pressedQueue = new Set();

  function takeLook() {
    const look = { x: state.lookX, y: state.lookY };
    state.lookX = 0;
    state.lookY = 0;
    return look;
  }

  function takePressed() {
    const pressed = new Set(pressedQueue);
    pressedQueue.clear();
    return pressed;
  }

  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      state.firing = false;
      state.scoped = false;
    }
    onLockChange(state.locked);
  });

  document.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });

  document.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.scoped = true;
  });
  document.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.scoped = false;
  });
  document.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    state.keys.add(event.code);
    pressedQueue.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  });
  window.addEventListener('keyup', (event) => state.keys.delete(event.code));
  window.addEventListener('blur', () => {
    state.keys.clear();
    state.firing = false;
    state.scoped = false;
  });

  function requestLock() {
    canvas.requestPointerLock();
  }

  return { state, takeLook, takePressed, requestLock };
}
