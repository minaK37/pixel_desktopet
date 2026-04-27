const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const windowConfigPath = path.join(app.getPath('userData'), 'pixel_pet_window_config.json');
function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(windowConfigPath, 'utf-8'));
    } catch (e) {
        return { MOVE_RANGE: 1.0 };
    }
}

function saveConfig(newData) {
    const dir = path.dirname(windowConfigPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    let current = {};
    try {
        current = JSON.parse(fs.readFileSync(windowConfigPath, 'utf-8'));
    } catch { }

    const merged = { ...current, ...newData };
    fs.writeFileSync(windowConfigPath, JSON.stringify(merged, null, 2));
    return merged;
}

const isDebugMode = process.argv.includes('--dev-mode');

const configPath = path.join(__dirname, "config", "config.json");
const mainConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

function stopWalking() {
    if (walkInterval) {
        clearInterval(walkInterval);
        walkInterval = null;
    }
}

let mainWindow;
let walkInterval = null;
let baseX = null;
let baseY = null;
let MOVE_RANGE_H = mainConfig.MOVE_RANGE_H;
let MOVE_RANGE_V = mainConfig.MOVE_RANGE_V;

app.on('ready', () => {
    const config = loadConfig();

    if (config.MOVE_RANGE) {
        MOVE_RANGE_H = MOVE_RANGE_H * config.MOVE_RANGE;
        MOVE_RANGE_V = MOVE_RANGE_V * config.MOVE_RANGE;
    }

    const defaultSize = mainConfig.WINDOW_SIZE_MIDDLE;

    mainWindow = new BrowserWindow({
        x: config.x ?? undefined,
        y: config.y ?? undefined,
        width: config.width ?? defaultSize,
        height: config.height ?? defaultSize,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        resizable: false,
        hasShadow: false,
        webPreferences: {
            preload: path.join(__dirname, 'js', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            additionalArguments: isDebugMode ? ['--electron-debug'] : [],
        },
    });
    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools({ mode: 'detach' });

    mainWindow.on('close', () => {
        stopWalking();
        const bounds = mainWindow.getBounds();
        saveConfig(bounds);
    });
});

ipcMain.on('show-context-menu', (event) => {
    stopWalking();
    const config = loadConfig();
    const template = [
        {
            label: '表示サイズ',
            submenu: [
                {
                    label: '小',
                    type: 'radio',
                    checked: mainWindow.getBounds().width === mainConfig.WINDOW_SIZE_SMALL,
                    click: () => {
                        mainWindow.setMinimumSize(0, 0);
                        mainWindow.setMaximumSize(10000, 10000);
                        mainWindow.setSize(mainConfig.WINDOW_SIZE_SMALL, mainConfig.WINDOW_SIZE_SMALL);
                        mainWindow.setMinimumSize(mainConfig.WINDOW_SIZE_SMALL, mainConfig.WINDOW_SIZE_SMALL);
                    }
                },
                {
                    label: '中',
                    type: 'radio',
                    checked: mainWindow.getBounds().width === mainConfig.WINDOW_SIZE_MIDDLE,
                    click: () => {
                        mainWindow.setMinimumSize(0, 0);
                        mainWindow.setMaximumSize(10000, 10000);
                        mainWindow.setSize(mainConfig.WINDOW_SIZE_MIDDLE, mainConfig.WINDOW_SIZE_MIDDLE);
                        mainWindow.setMinimumSize(mainConfig.WINDOW_SIZE_MIDDLE, mainConfig.WINDOW_SIZE_MIDDLE);
                    }
                },
                {
                    label: '大',
                    type: 'radio',
                    checked: mainWindow.getBounds().width === mainConfig.WINDOW_SIZE_BIG,
                    click: () => {
                        mainWindow.setMinimumSize(0, 0);
                        mainWindow.setMaximumSize(10000, 10000);
                        mainWindow.setSize(mainConfig.WINDOW_SIZE_BIG, mainConfig.WINDOW_SIZE_BIG);
                        mainWindow.setMinimumSize(mainConfig.WINDOW_SIZE_BIG, mainConfig.WINDOW_SIZE_BIG);
                    }
                },
            ]
        },
        {
            label: '移動範囲',
            submenu: [
                {
                    label: '小',
                    type: 'radio',
                    checked: config.MOVE_RANGE === mainConfig.MOVE_RANGE_SMALL,
                    click: () => {
                        saveConfig({ MOVE_RANGE: mainConfig.MOVE_RANGE_SMALL });
                        MOVE_RANGE_H = mainConfig.MOVE_RANGE_H * mainConfig.MOVE_RANGE_SMALL;
                        MOVE_RANGE_V = mainConfig.MOVE_RANGE_V * mainConfig.MOVE_RANGE_SMALL;
                    }
                },
                {
                    label: '中',
                    type: 'radio',
                    checked: config.MOVE_RANGE === mainConfig.MOVE_RANGE_MIDDLE,
                    click: () => {
                        saveConfig({ MOVE_RANGE: mainConfig.MOVE_RANGE_MIDDLE });
                        MOVE_RANGE_H = mainConfig.MOVE_RANGE_H * mainConfig.MOVE_RANGE_MIDDLE;
                        MOVE_RANGE_V = mainConfig.MOVE_RANGE_V * mainConfig.MOVE_RANGE_MIDDLE;
                    }
                },
                {
                    label: '大',
                    type: 'radio',
                    checked: config.MOVE_RANGE === mainConfig.MOVE_RANGE_BIG,
                    click: () => {
                        saveConfig({ MOVE_RANGE: mainConfig.MOVE_RANGE_BIG });
                        MOVE_RANGE_H = mainConfig.MOVE_RANGE_H * mainConfig.MOVE_RANGE_BIG;
                        MOVE_RANGE_V = mainConfig.MOVE_RANGE_V * mainConfig.MOVE_RANGE_BIG;
                    }
                }
            ]
        },
        { type: 'separator' },
        {
            label: 'アプリを終了',
            click: () => { app.quit(); }
        },
        // {
        //     label: '開発者ツール',
        //     click: () => { mainWindow.webContents.openDevTools({ mode: 'detach' }); }
        // }
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow });
});

ipcMain.on('close-app', () => {
    stopWalking();
    app.quit();
});

ipcMain.handle('get-window-bounds', () => {
    stopWalking();
    return mainWindow.getBounds();
});

ipcMain.on('move-window', (event, { x, y, width, height }) => {
    stopWalking();
    mainWindow.setBounds({ x, y, width, height });
    baseX = mainWindow.getBounds().x;
    baseY = mainWindow.getBounds().y;
});

ipcMain.on('start-walking', (event, { duration, direction, VH }) => {
    if (!mainWindow) return;
    if (walkInterval) {
        clearInterval(walkInterval);
        walkInterval = null;
    }
    if (baseX === null) baseX = mainWindow.getBounds().x;
    if (baseY === null) baseY = mainWindow.getBounds().y;

    let elapsed = 0;
    let step = 40;
    const speed = (direction === 'left' || direction === 'down') ? -1 : 1;

    walkInterval = setInterval(() => {
        if (elapsed >= duration) {
            clearInterval(walkInterval);
            walkInterval = null;
            return;
        }
        const bounds = mainWindow.getBounds();
        let newX = bounds.x;
        let newY = bounds.y;

        if (VH === 'horizontal') {
            newX += speed;
            if (Math.abs(newX - baseX) <= MOVE_RANGE_H) {
                mainWindow.setBounds({ x: newX, y: newY, width: bounds.width, height: bounds.height });
            }
        } else if (VH === 'vertical') {
            step = 200;
            newY += speed;
            if (Math.abs(newY - baseY) <= MOVE_RANGE_V) {
                mainWindow.setBounds({ x: newX, y: newY, width: bounds.width, height: bounds.height });
            }
        }

        elapsed += step;
    }, step);
});

ipcMain.on('stop-walking', () => {
    stopWalking();
});

// Returns bounds without stopping walking — used by debug distance display.
ipcMain.handle('get-window-position', () => {
    return mainWindow.getBounds();
});

ipcMain.handle('get-screen-bounds', () => {
    return screen.getPrimaryDisplay().workArea;
});

// Returns the walk base position and current MOVE_RANGE values for debug display.
ipcMain.handle('get-move-bounds', () => ({
    baseX:  baseX,
    baseY:  baseY,
    rangeH: MOVE_RANGE_H,
    rangeV: MOVE_RANGE_V,
}));
