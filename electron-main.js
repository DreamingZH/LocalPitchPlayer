const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#00000000', // 透明以便适应背景色
            symbolColor: '#7a8599',
            height: 32
        },
        icon: path.join(__dirname, 'LocalPitchPlayer.png'),
        autoHideMenuBar: true // 自动隐藏顶部菜单栏
    });

    win.setMenu(null); // 完全移除工具栏（如果觉得 autoHide 还有按 Alt 会出现的问题，这句可以彻底干掉菜单）
    win.maximize();
    win.loadFile('index.html');

    // 关键：阻止文件拖拽时触发页面导航（这是 Electron 的默认行为导致拖拽失效）
    win.webContents.on('will-navigate', (event, url) => {
        // 阻止所有 file:// 协议的非页面导航（即文件拖拽）
        if (url.startsWith('file://') && !url.endsWith('.html')) {
            event.preventDefault();
        }
    });

    // 监听来自页面的图标更新（歌曲封面）
    ipcMain.on('update-icon', (event, dataUrl) => {
        if (dataUrl) {
            const image = nativeImage.createFromDataURL(dataUrl);
            win.setIcon(image);
        } else {
            win.setIcon(path.join(__dirname, 'LocalPitchPlayer.png'));
        }
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
