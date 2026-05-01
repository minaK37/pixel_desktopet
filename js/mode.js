function _randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// h:0-359, s/v:0-100 -> "#RRGGBB"
function _hsvToHex(h, s, v) {
    const hh = ((h % 360) + 360) % 360;
    const ss = Math.max(0, Math.min(100, s)) / 100;
    const vv = Math.max(0, Math.min(100, v)) / 100;

    const c = vv * ss;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = vv - c;

    let rp = 0, gp = 0, bp = 0;
    if (hh < 60) { rp = c; gp = x; bp = 0; }
    else if (hh < 120) { rp = x; gp = c; bp = 0; }
    else if (hh < 180) { rp = 0; gp = c; bp = x; }
    else if (hh < 240) { rp = 0; gp = x; bp = c; }
    else if (hh < 300) { rp = x; gp = 0; bp = c; }
    else { rp = c; gp = 0; bp = x; }

    const toHex = n => Math.round((n + m) * 255).toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(rp)}${toHex(gp)}${toHex(bp)}`;
}

function _randomBodyColorHex() {
    const h = _randomInt(0, 359);
    const s = _randomInt(35, 100);
    const v = _randomInt(51, 100); // body: always bright enough
    return _hsvToHex(h, s, v);
}

function _randomBorderEyeColorHex() {
    const h = _randomInt(0, 359);
    const s = _randomInt(20, 100);
    const v = _randomInt(0, 50); // border/eye: always dark enough
    return _hsvToHex(h, s, v);
}

function performModeChange() {
    const pool = window.appConfig.modePool;
    const picked = pool[Math.floor(Math.random() * pool.length)];

    if (picked.key === 'bodyColor') {
        renderer.setMode('bodyColor', _randomBodyColorHex());
    } else if (picked.key === 'borderColor' || picked.key === 'eyeColor') {
        renderer.setMode(picked.key, _randomBorderEyeColorHex());
    } else {
        renderer.setMode(picked.key, picked.value);
    }

    startIdleCycle();
}

function performModeReset() {
    _doModeResetCinematic();
}

const _modeSleep = ms => new Promise(r => setTimeout(r, ms));

async function _doModeResetCinematic() {
    if (isDragging || isJumping) return;
    isJumping = true;

    const bounds = await window.electronAPI.getWindowBounds();
    const { x: bx, y: by, width: bw, height: bh } = bounds;

    // 1) Tremble like action tremble.
    const HALF_CYCLES = 32;
    const STEP_MS = 30;
    const AMP = 3;
    for (let i = 0; i < HALF_CYCLES; i++) {
        if (isDragging) {
            resetMovementState();
            isJumping = false;
            startIdleCycle();
            return;
        }
        const offset = i % 2 === 0 ? AMP : -AMP;
        window.electronAPI.moveWindow({ x: bx + offset, y: by, width: bw, height: bh });
        await _modeSleep(STEP_MS);
    }
    window.electronAPI.moveWindow({ x: bx, y: by, width: bw, height: bh });

    // 2) Scatter all parts.
    const pieces = [];
    const P = 8;
    const bc = renderer.modes.borderColor || '#000000';
    const fc = renderer.modes.bodyColor || '#FFFFFF';
    const ec = renderer.modes.eyeColor || '#000000';
    const alpha = renderer.modes.bodyAlpha ?? 1;
    const withAlpha = (hex, a) => {
        if (a >= 1) return hex;
        const aa = Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase();
        return `${hex}${aa}`;
    };
    const bcA = withAlpha(bc, alpha);
    const fcA = withAlpha(fc, alpha);
    const ecA = withAlpha(ec, alpha);

    for (let y = P; y < P + 32; y += 2) {
        for (let x = P; x < P + 32; x += 2) {
            const inBorder = x < P + 3 || x >= P + 29 || y < P + 3 || y >= P + 29;
            const inLeftEye = x >= P + 7 && x <= P + 11 && y >= P + 10 && y <= P + 14;
            const inRightEye = x >= P + 17 && x <= P + 21 && y >= P + 10 && y <= P + 14;
            const c = inLeftEye || inRightEye ? ecA : (inBorder ? bcA : fcA);
            pieces.push({
                x, y, sz: 2, c,
                vx: (Math.random() * 2 - 1) * 1.8,
                vy: (Math.random() * 2 - 1) * 1.8,
            });
        }
    }

    renderer.setResetFx({ active: true, phase: 'scatter', pieces });
    for (let f = 0; f < 120; f++) {
        if (isDragging) break;
        for (const p of pieces) {
            p.x += p.vx;
            p.y += p.vy;
        }
        renderer.setResetFx({ active: true, phase: 'scatter', pieces });
        const allOut = pieces.every(p => p.x + p.sz < 0 || p.y + p.sz < 0 || p.x > 48 || p.y > 48);
        if (allOut) break;
        await _modeSleep(16);
    }

    // 3) Once scattered, reset all modes and rebuild from a tiny square.
    renderer.resetModes();
    renderer.setResetFx({ active: true, phase: 'seed' });
    await _modeSleep(200);

    for (let h = 4; h <= 32; h += 2) {
        renderer.setResetFx({ active: true, phase: 'growV', h });
        await _modeSleep(26);
    }
    for (let w = 4; w <= 32; w += 2) {
        renderer.setResetFx({ active: true, phase: 'growH', w });
        await _modeSleep(26);
    }

    // 4) Blink 3 times while eyes appear.
    renderer.setResetFx({ active: true, phase: 'blink', eyes: 'normal' });
    for (let i = 0; i < 3; i++) {
        await _modeSleep(90);
        renderer.setResetFx({ active: true, phase: 'blink', eyes: 'closed' });
        await _modeSleep(110);
        renderer.setResetFx({ active: true, phase: 'blink', eyes: 'normal' });
    }
    await _modeSleep(120);

    renderer.clearResetFx();
    resetMovementState();
    isJumping = false;
    startIdleCycle();
}
