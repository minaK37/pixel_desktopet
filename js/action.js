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
        case 'jump': performJump(); break;
        case 'spin': performSpin(); break;
        case 'spin_reverse': performSpinReverse(); break;
        case 'squash': performSquash(); break;
        case 'rhythm': performRhythm(); break;
        case 'tremble': performTremble(); break;
        case 'shrink': performShrink(); break;
        case 'marquee': performMarquee(); break;
        default: startIdleCycle(); break;
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
//   1. Squash in place   (1.25x wide, 0.75x tall)  Eanticipation
//   2. Rise              (0.75x wide, 1.0x tall)   Ewindow moves up ~100px
//   3. Peak squash       (1.25x wide, 0.75x tall)  Ebrief float at apex
//   4. Fall              (0.75x wide, 1.0x tall)   Ewindow moves back down
//   5. Land squash       (1.25x wide, 0.75x tall)  Eimpact
//   6. Return to normal  (1x, 1x)

async function performJump() {
    isJumping = true;

    const JUMP_HEIGHT = 100;
    const STEP_MS = 16;
    const RISE_STEPS = 25;
    const FALL_STEPS = 25;

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
// sign=1 ↁEcounterclockwise, sign=-1 ↁEclockwise.

async function _doSpin(sign) {
    isJumping = true;

    const STEPS = 30;
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

async function performSpin() { await _doSpin(1); }
async function performSpinReverse() { await _doSpin(-1); }

// ── Squash in place ───────────────────────────────────────────────────────────
//
// Gradually flatten and widen (500ms), hold with eyes closed (400ms),
// then slowly recover (600ms). Total ~1500ms.

async function performSquash() {
    isJumping = true;

    const MAX_SX = 1.6;
    const MIN_SY = 0.4;
    const IN_STEPS = 20;  // 20 ÁE25ms = 500ms
    const OUT_STEPS = 20;  // 20 ÁE30ms = 600ms
    const HOLD_MS = 400;

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
    const CYCLES = 10;
    const SX = 1.2;
    const SY = 0.8;
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

// ── Tremble ───────────────────────────────────────────────────────────────────
//
// Rapid left-right oscillation in place. 8 cycles ÁE30ms each half = ~480ms total.

async function performTremble() {
    isJumping = true;

    const bounds = await window.electronAPI.getWindowBounds();
    const { x: bx, y: by, width: bw, height: bh } = bounds;

    const HALF_CYCLES = 32; // 16 half-cycles = 8 full oscillations
    const STEP_MS = 30;
    const AMP = 3;  // ±3px

    for (let i = 0; i < HALF_CYCLES; i++) {
        if (isDragging) { _finishAction(); return; }
        const offset = i % 2 === 0 ? AMP : -AMP;
        window.electronAPI.moveWindow({ x: bx + offset, y: by, width: bw, height: bh });
        await sleep(STEP_MS);
    }

    window.electronAPI.moveWindow({ x: bx, y: by, width: bw, height: bh });
    _finishAction();
}

// ── Shrink action ─────────────────────────────────────────────────────────────
//
// 1) Instant stepped shrink with short pauses: 80% -> 50% -> 30% -> 10%
// 2) Hold at minimum
// 3) Smooth expand from 10% back to 100%
// Eyes are "drag (XX)" during shrink+hold, then return to normal during expand.

async function performShrink() {
    isJumping = true;

    const STEPS = [0.8, 0.5, 0.3, 0.1];
    const STEP_HOLD_MS = 360;  // 3x
    const MIN_HOLD_MS = 1560; // 6x
    const EXPAND_STEPS = 30;
    const EXPAND_MS = 60;   // 3x

    const abort = () => {
        renderer.setMode('sizeScale', 1);
        renderer.setExpression('normal');
        _finishAction();
    };

    renderer.setExpression('drag');
    for (const scale of STEPS) {
        if (isDragging) { abort(); return; }
        renderer.setMode('sizeScale', scale);
        await sleep(STEP_HOLD_MS);
    }

    if (isDragging) { abort(); return; }
    await sleep(MIN_HOLD_MS);

    renderer.setExpression('normal');
    for (let i = 1; i <= EXPAND_STEPS; i++) {
        if (isDragging) { abort(); return; }
        const t = i / EXPAND_STEPS;
        const scale = 0.1 + (1 - 0.1) * t;
        renderer.setMode('sizeScale', scale);
        await sleep(EXPAND_MS);
    }

    renderer.setMode('sizeScale', 1);
    _finishAction();
}

// ── Marquee message ──────────────────────────────────────────────────────────
//
// Scroll hard-coded message on the lower body area like an LED sign.
// Message text is intentionally hard-coded for now.

async function performMarquee() {
    isJumping = true;

    const TEXTS = window.appConfig.marqueeMessages && window.appConfig.marqueeMessages.length > 0
        ? window.appConfig.marqueeMessages
        : ['HELLO WORLD!'];
    const template = TEXTS[Math.floor(Math.random() * TEXTS.length)];
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const TEXT = String(template).replaceAll('{{now_time}}', `${hh}:${mm}`);
    const VIEWPORT_W = 24;           // must match renderer marquee viewport width
    const GLYPH_ADV = 6;             // 5px glyph + 1px spacing
    const textW = TEXT.length * GLYPH_ADV;
    const FRAME_MS = window.appConfig.marqueeFrameMs ?? 65;

    renderer.setExpression('normal');

    // Start from outside right, exit to left.
    for (let off = VIEWPORT_W; off >= -textW; off--) {
        if (isDragging) {
            renderer.clearMarquee();
            _finishAction();
            return;
        }
        renderer.setMarquee(TEXT, off, true);
        await sleep(FRAME_MS);
    }

    renderer.clearMarquee();
    _finishAction();
}

