(function initDebug() {
    if (!window.debugMode) return;

    const panel     = document.getElementById('debug-panel');
    const toggleBtn = document.getElementById('debug_toggle');

    panel.style.display        = 'block';
    toggleBtn.style.display    = 'inline';
    toggleBtn.style.opacity    = '1';
    toggleBtn.style.transition = 'none';

    let panelVisible = true;
    toggleBtn.addEventListener('click', () => {
        panelVisible = !panelVisible;
        panel.style.display    = panelVisible ? 'block' : 'none';
        toggleBtn.style.opacity = panelVisible ? '1' : '0.4';
    });

    let isDebugWalking = false;
    const WALK_MS = 2000;

    // ── Remaining distance display (updates every 200ms) ──────────────────────
    // Shows how many px remain within the current MOVE_RANGE from the walk base.
    // base is set when walking starts or when the window is moved (drag/jump).
    // If no walk has happened yet (baseX === null), current position is treated
    // as base, so full range is available in both directions.

    setInterval(async () => {
        const [b, mb] = await Promise.all([
            window.electronAPI.getWindowPosition(),
            window.electronAPI.getMoveBounds(),
        ]);
        const bx    = mb.baseX !== null ? mb.baseX : b.x;
        const by    = mb.baseY !== null ? mb.baseY : b.y;
        const clamp = v => Math.max(0, Math.round(v));

        document.getElementById('dbg-left').textContent  = `← ${clamp(b.x - (bx - mb.rangeH))}`;
        document.getElementById('dbg-right').textContent = `→ ${clamp((bx + mb.rangeH) - b.x)}`;
        document.getElementById('dbg-up').textContent    = `↑ ${clamp(b.y - (by - mb.rangeV))}`;
        document.getElementById('dbg-down').textContent  = `↓ ${clamp((by + mb.rangeV) - b.y)}`;
    }, 200);

    // ── Helpers ───────────────────────────────────────────────────────────────

    function on(id, fn) {
        document.getElementById(id).addEventListener('click', fn);
    }

    function canAct() { return !isDragging && !isJumping && !isDebugWalking; }

    function startWalk(facingDir, trailDir, eyeOff, walkFn) {
        if (!canAct()) return;
        isDebugWalking = true;
        renderer.setFacing(facingDir);
        renderer.setTrailSide(trailDir);
        renderer.setEyeOffsetY(eyeOff);
        renderer.setExpression(DEFAULT_STATE);
        walkFn(WALK_MS, facingDir === 'left' || facingDir === 'right' ? 'horizontal' : 'vertical');
        setTimeout(() => {
            window.electronAPI.stopWalking();
            resetMovementState();
            isDebugWalking = false;
        }, WALK_MS);
    }

    // ── Movement ──────────────────────────────────────────────────────────────

    on('dbg-wl', () => startWalk('left',  'right', 0,  window.electronAPI.walkLeft));
    on('dbg-wr', () => startWalk('right', 'left',  0,  window.electronAPI.walkRight));
    on('dbg-wu', () => startWalk('left',  'none',  2,  window.electronAPI.walkUp));
    on('dbg-wd', () => startWalk('left',  'none',  -2, window.electronAPI.walkDown));

    // ── Actions ───────────────────────────────────────────────────────────────

    on('dbg-jump',   () => { if (canAct()) performJump();        });
    on('dbg-spin',   () => { if (canAct()) performSpin();        });
    on('dbg-spinr',  () => { if (canAct()) performSpinReverse(); });
    on('dbg-squash', () => { if (canAct()) performSquash();      });
    on('dbg-rhythm', () => { if (canAct()) performRhythm();      });

    // ── Mode ──────────────────────────────────────────────────────────────────

    on('dbg-mc', () => performModeChange());
    on('dbg-mr', () => performModeReset());

})();
