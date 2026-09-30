const { app, BrowserWindow, ipcMain, nativeImage, shell } = require('electron');
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
    // 渲染进程内的任何跳转都应被拦截：拖入 .html 等文件会直接覆盖播放器页面，
    // 导致播放列表与音频图全部丢失且无法返回。应用是单页的，不依赖页面跳转。
    win.webContents.on('will-navigate', (event, url) => {
        event.preventDefault();
    });

    // target="_blank" 的外部链接交给系统浏览器打开。
    // 默认行为会新建一个继承 nodeIntegration/contextIsolation 设置的窗口去加载远程站点，
    // 等于把 Node 完整暴露给外部内容。
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
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
