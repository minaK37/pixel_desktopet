function performModeChange() {
    const pool   = window.appConfig.modePool;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    renderer.setMode(picked.key, picked.value);
    startIdleCycle();
}

function performModeReset() {
    renderer.resetModes();
    startIdleCycle();
}
