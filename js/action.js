function performAction() {
    const pool = window.appConfig.actionPool;
    if (!pool || pool.length === 0) { startIdleCycle(); return; }

    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    let rand = Math.random() * total;
    for (const item of pool) {
        if (rand < item.weight) { _dispatchAction(item.action); return; }
        rand -= item.weight;
    }
    _dispatchAction(pool[pool.length - 1].action);
}

function _dispatchAction(name) {
    switch (name) {
        case 'jump':         performJump(); break;
        case 'spin':         performSpin(); break;
        case 'spin_reverse': performSpinReverse(); break;
        case 'squash':       performSquash(); break;
        case 'rhythm':       performRhythm(); break;
        default:             startIdleCycle(); break;
    }
}

function _finishAction() {
    isJumping = false;
    if (!isDragging) {
        resetMovementState();
        startIdleCycle();
    }
}

// ── Jump ─────────────────────────────────────────────────────────────────────
//
// Sequence:
//   1. Squash in place   (1.25x wide, 0.75x tall) – anticipation
//   2. Rise              (0.75x wide, 1.0x tall)  – window moves up ~100px
//   3. Peak squash       (1.25x wide, 0.75x tall) – brief float at apex
//   4. Fall              (0.75x wide, 1.0x tall)  – window moves back down
//   5. Land squash       (1.25x wide, 0.75x tall) – impact
//   6. Return to normal  (1x, 1x)

async function performJump() {
    isJumping = true;

    const JUMP_HEIGHT = 100;
    const STEP_MS     = 16;
    const RISE_STEPS  = 25;
    const FALL_STEPS  = 25;

    const bounds = await window.electronAPI.getWindowBounds();
    const { x: bx, y: by, width: bw, height: bh } = bounds;

    renderer.setShape(1.25, 0.75);
    await sleep(200);
    if (isDragging) { _finishAction(); return; }

    renderer.setShape(0.75, 1.0);
    for (let i = 1; i <= RISE_STEPS; i++) {
        if (isDragging) { _finishAction(); return; }
        window.electronAPI.moveWindow({
            x: bx, y: by - Math.round(JUMP_HEIGHT * i / RISE_STEPS),
            width: bw, height: bh,
        });
        await sleep(STEP_MS);
    }

    renderer.setShape(1.25, 0.75);
    await sleep(150);
    if (isDragging) { _finishAction(); return; }

    renderer.setShape(0.75, 1.0);
    for (let i = 1; i <= FALL_STEPS; i++) {
        if (isDragging) { _finishAction(); return; }
        window.electronAPI.moveWindow({
            x: bx, y: by - Math.round(JUMP_HEIGHT * (1 - i / FALL_STEPS)),
            width: bw, height: bh,
        });
        await sleep(STEP_MS);
    }

    window.electronAPI.moveWindow({ x: bx, y: by, width: bw, height: bh });
    renderer.setShape(1.25, 0.75);
    await sleep(200);

    renderer.setShape(1, 1);
    await sleep(150);

    _finishAction();
}

// ── Spin ─────────────────────────────────────────────────────────────────────
//
// One full 360° rotation (~500 ms), then a brief landing squash.
// sign=1 → counterclockwise, sign=-1 → clockwise.

async function _doSpin(sign) {
    isJumping = true;

    const STEPS   = 30;
    const STEP_MS = 16;

    for (let i = 1; i <= STEPS; i++) {
        if (isDragging) { _finishAction(); return; }
        renderer.setRotation(sign * (2 * Math.PI * i) / STEPS);
        await sleep(STEP_MS);
    }
    renderer.setRotation(0);

    renderer.setShape(1.25, 0.75);
    await sleep(150);
    renderer.setShape(1, 1);
    await sleep(100);

    _finishAction();
}

async function performSpin()        { await _doSpin( 1); }
async function performSpinReverse() { await _doSpin(-1); }

// ── Squash in place ───────────────────────────────────────────────────────────
//
// Gradually flatten and widen (500ms), hold with eyes closed (400ms),
// then slowly recover (600ms). Total ~1500ms.

async function performSquash() {
    isJumping = true;

    const MAX_SX    = 1.6;
    const MIN_SY    = 0.4;
    const IN_STEPS  = 20;  // 20 × 25ms = 500ms
    const OUT_STEPS = 20;  // 20 × 30ms = 600ms
    const HOLD_MS   = 400;

    for (let i = 1; i <= IN_STEPS; i++) {
        if (isDragging) { _finishAction(); return; }
        const t = i / IN_STEPS;
        renderer.setShape(1 + (MAX_SX - 1) * t, 1 + (MIN_SY - 1) * t);
        await sleep(25);
    }
    renderer.setExpression('blink_closed');

    await sleep(HOLD_MS);
    if (isDragging) { _finishAction(); return; }

    renderer.setExpression('normal');
    for (let i = 1; i <= OUT_STEPS; i++) {
        if (isDragging) { _finishAction(); return; }
        const t = i / OUT_STEPS;
        renderer.setShape(MAX_SX + (1 - MAX_SX) * t, MIN_SY + (1 - MIN_SY) * t);
        await sleep(30);
    }
    renderer.setShape(1, 1);

    _finishAction();
}

// ── Rhythm bounce ─────────────────────────────────────────────────────────────
//
// 3-beat pattern: squash on beat 1, rest on beats 2-3.
// 10 cycles = 10 squashes. Total ~4500ms.

async function performRhythm() {
    isJumping = true;

    const BEAT_MS = 150;
    const CYCLES  = 10;
    const SX      = 1.2;
    const SY      = 0.8;
    const HOLD_MS = 50;

    for (let c = 0; c < CYCLES; c++) {
        if (isDragging) { _finishAction(); return; }

        // Beat 1: squash
        renderer.setShape(SX, SY);
        await sleep(HOLD_MS);
        renderer.setShape(1, 1);
        await sleep(BEAT_MS - HOLD_MS);

        // Beats 2-3: rest
        await sleep(BEAT_MS * 2);
    }

    _finishAction();
}
