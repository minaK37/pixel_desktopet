let idleTimer  = null;
let isDragging = false;
let isJumping  = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const { MIN_WAIT, MAX_WAIT, DEFAULT_STATE, DRAG_STATE, idleImages, hourlyImages } = window.appConfig;

const renderer = new PetRenderer('pet-canvas', Math.round(window.innerWidth / PET_CANVAS_SIZE));

// Recalculate scale whenever the window is resized (e.g. via the size menu).
// PET_CANVAS_SIZE (48) is declared in pet_renderer.js, loaded before this file.
window.addEventListener('resize', () => {
    const newScale = Math.round(window.innerWidth / PET_CANVAS_SIZE);
    renderer.setScale(newScale);
});

setupEvents();
startIdleCycle();

function setupEvents() {
    const menuButton = document.getElementById('menu_button');
    const menu       = document.getElementById('menu');
    const canvas     = document.getElementById('pet-canvas');
    const appClose   = document.getElementById('app_close');

    menuButton.addEventListener('click', (e) => {
        e.preventDefault();
        window.electronAPI.showContextMenu();
    });

    appClose.addEventListener('click', (e) => {
        e.preventDefault();
        window.electronAPI.closeApp();
    });

    let offset     = { x: 0, y: 0 };
    let dragWidth  = 0;
    let dragHeight = 0;

    canvas.addEventListener('mousedown', async (e) => {
        if (e.button !== 0) return;
        isDragging = true;
        clearTimeout(idleTimer);
        renderer.setTrailSide('none');
        renderer.setEyeOffsetY(0);
        renderer.setExpression(DRAG_STATE);

        const bounds = await window.electronAPI.getWindowBounds();
        offset     = { x: e.screenX - bounds.x, y: e.screenY - bounds.y };
        dragWidth  = bounds.width;
        dragHeight = bounds.height;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const x = Math.round(e.screenX - offset.x);
        const y = Math.round(e.screenY - offset.y);
        window.electronAPI.moveWindow({ x, y, width: dragWidth, height: dragHeight });
    });

    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        resetMovementState();
        menu.classList.remove('hovered');
        startIdleCycle();
    });
}

function resetMovementState() {
    renderer.setFacing('left');
    renderer.setTrailSide('none');
    renderer.setEyeOffsetY(0);
    renderer.setShape(1, 1);
    renderer.setRotation(0);
    renderer.setExpression(DEFAULT_STATE);
}

function pickRandomAnimation() {
    const total = idleImages.reduce((sum, item) => sum + item.weight, 0);
    let rand = Math.random() * total;
    for (const item of idleImages) {
        if (rand < item.weight) return item;
        rand -= item.weight;
    }
    return { default_continue: true };
}

function startIdleCycle(skipWait = false) {
    clearTimeout(idleTimer);
    if (window.debugMode) return;

    const wait = skipWait ? 0 : MIN_WAIT + Math.random() * (MAX_WAIT - MIN_WAIT);

    idleTimer = setTimeout(() => {
        if (isDragging || isJumping) return;

        const picked = pickRandomAnimation();
        if (picked.default_continue) {
            startIdleCycle();
            return;
        }

        // Action: pick from actionPool and execute.
        if (picked.move === 'action') {
            performAction();
            return;
        }

        // Mode change/reset: apply immediately and restart the cycle.
        if (picked.move === 'mode_change') {
            performModeChange();
            return;
        }
        if (picked.move === 'mode_reset') {
            performModeReset();
            return;
        }

        const uptimeMs = picked.uptime_range ? picked.uptime + wait : picked.uptime;

        if (picked.move === 'horizontal') {
            if (Math.random() < 0.5) {
                // Moving right: flip character, trail appears on the left (behind)
                renderer.setFacing('right');
                renderer.setTrailSide('left');
                window.electronAPI.walkRight(uptimeMs, picked.move);
            } else {
                // Moving left: normal orientation, trail appears on the right (behind)
                renderer.setFacing('left');
                renderer.setTrailSide('right');
                window.electronAPI.walkLeft(uptimeMs, picked.move);
            }
        } else if (picked.move === 'vertical') {
            renderer.setFacing('left');
            renderer.setTrailSide('none');
            if (Math.random() < 0.5) {
                // walkUp moves window downward (screen Y increases), so eyes shift down
                renderer.setEyeOffsetY(2);
                window.electronAPI.walkUp(uptimeMs, picked.move);
            } else {
                // walkDown moves window upward (screen Y decreases), so eyes shift up
                renderer.setEyeOffsetY(-2);
                window.electronAPI.walkDown(uptimeMs, picked.move);
            }
        }

        renderer.setExpression(picked.expression || DEFAULT_STATE);

        setTimeout(() => {
            if (isDragging) return;
            window.electronAPI.stopWalking();
            resetMovementState();

            if (picked.move && Math.random() < 0.1) {
                startIdleCycle(true);
            } else {
                startIdleCycle();
            }
        }, uptimeMs);
    }, wait);
}

setInterval(() => {
    const now = new Date();
    if (now.getMinutes() === 0) checkHourlyEvent();
}, 60000);

// ── Hourly event ─────────────────────────────────────────────────────────────

function checkHourlyEvent() {
    const now = new Date();
    const h   = now.getHours().toString();
    const entry = hourlyImages[h] || hourlyImages['default'];
    if (!entry) return;

    clearTimeout(idleTimer);
    renderer.setExpression(entry.expression || DEFAULT_STATE);

    setTimeout(() => {
        resetMovementState();
        startIdleCycle();
    }, entry.uptime || 3000);
}
