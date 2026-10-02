const { app, BrowserWindow, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');

// 图标更新监听只注册一次，并在派发时查找当前存活的窗口。
// 若放进 createWindow()，macOS 关窗重开会让监听器不断累积：
// 每个监听器闭包捕获的是创建时的 win，第二个窗口的封面会被设到已销毁的第一个窗口上。
function registerIconListener() {
    ipcMain.on('update-icon', (event, dataUrl) => {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length === 0) return;
        const win = windows[windows.length - 1];

        if (dataUrl) {
            try {
                win.setIcon(nativeImage.createFromDataURL(dataUrl));
            } catch (e) {
                // 封面数据异常时退回默认图标，不要让 IPC 抛错影响播放
                win.setIcon(path.join(__dirname, 'LocalPitchPlayer.png'));
            }
        } else {
            win.setIcon(path.join(__dirname, 'LocalPitchPlayer.png'));
        }
    });
}

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

    // 不再无条件 maximize——那样上面设的 width/height 永远不生效，
    // 用户每次启动都被强制全屏、无法按自己的习惯摆窗口。
    // 例外是 macOS：titleBarStyle:'hidden' 会隐藏红绿灯按钮
    // （titleBarOverlay 只在 Windows/Linux 生效），没有窗口控制可用，
    // 那里仍然自动铺满。
    if (process.platform === 'darwin') {
        win.maximize();
    }

    win.loadFile('index.html');

    // 关键：阻止文件拖拽时触发页面导航（这是 Electron 的默认行为导致拖拽失效）
    // 渲染进程内的任何跳转都应被拦截：拖入 .html 等文件会直接覆盖播放器页面，
    // 导致播放列表与音频图全部丢失且无法返回。应用是单页的，不依赖页面跳转。
    win.webContents.on('will-navigate', (event, url) => {
        event.preventDefault();
    });

    // 外部链接交给系统浏览器打开。
    // 默认行为会新建一个继承 nodeIntegration/contextIsolation 设置的窗口去加载远程站点，
    // 等于把 Node 完整暴露给外部内容。
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });
}

app.whenReady().then(() => {
    registerIconListener();
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
