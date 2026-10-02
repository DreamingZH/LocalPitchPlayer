/**
 * 国际化模块
 */
const i18n = (function () {
    // 语言包
    const translations = {
        'zh': {
            selectFolder: '选择文件夹',
            selectFile: '选择文件',
            searchPlaceholder: '搜索歌曲...',
            dragDropHint: '将音频文件拖放到此处',
            pitchShift: '变调',
            prev: '上一曲',
            play: '播放',
            pause: '暂停',
            next: '下一曲',
            shuffle: '随机',
            loop: '循环',
            tempoShift: '变速',
            onlineTitle: '在线音乐',
            onlineClose: '关闭',
            onlinePlaceholder: '搜索歌曲、歌手...',
            onlineSearching: '搜索中...',
            onlineEmptyMain: '搜索你喜欢的音乐',
            onlineEmptyHint: '支持网易云、QQ音乐、酷狗',
            onlineEmptySub: '点击歌曲将添加到主播放列表',
            onlineNoResults: '没有找到相关歌曲',
            onlineSearchFailed: '搜索失败，请稍后重试',
            onlineNotReady: '主播放器未就绪，请稍后重试',
            onlineBadId: '无法解析歌曲ID',
            onlineAddFailed: '添加失败: ',
            onlinePreparing: '准备下载...',
            onlineCover: '正在获取封面...',
            onlineAudio: '正在获取音频...',
            onlineProcessing: '正在处理...',
            onlineFromCache: '从缓存加载...',
            onlineAddToPlaylist: '添加到播放列表...',
            onlineDownloading: '正在下载 {received}/{total} MB',
            onlineDownloadingUnknown: '正在下载 {received} MB',
            onlineAddTitle: '添加到播放列表并播放',
            onlineAdded: '已添加',
            onlineServerNetease: '网易云',
            onlineServerTencent: 'QQ音乐',
            onlineServerKugou: '酷狗',
        },
        'en': {
            selectFolder: 'Select Folder',
            selectFile: 'Select File',
            searchPlaceholder: 'Search songs...',
            dragDropHint: 'Drop audio files here',
            pitchShift: 'Pitch Shift',
            prev: 'Prev',
            play: 'Play',
            pause: 'Pause',
            next: 'Next',
            shuffle: 'Shuffle',
            loop: 'Loop',
            tempoShift: 'Tempo Shift',
            onlineTitle: 'Online Music',
            onlineClose: 'Close',
            onlinePlaceholder: 'Search songs, artists...',
            onlineSearching: 'Searching...',
            onlineEmptyMain: 'Search the music you like',
            onlineEmptyHint: 'NetEase / QQ Music / Kugou supported',
            onlineEmptySub: 'Click a song to add it to the playlist',
            onlineNoResults: 'No songs found',
            onlineSearchFailed: 'Search failed, please try again later',
            onlineNotReady: 'Main player not ready, please try again later',
            onlineBadId: 'Failed to parse song ID',
            onlineAddFailed: 'Failed to add: ',
            onlinePreparing: 'Preparing...',
            onlineCover: 'Fetching cover...',
            onlineAudio: 'Fetching audio...',
            onlineProcessing: 'Processing...',
            onlineFromCache: 'Loading from cache...',
            onlineAddToPlaylist: 'Adding to playlist...',
            onlineDownloading: 'Downloading {received}/{total} MB',
            onlineDownloadingUnknown: 'Downloading {received} MB',
            onlineAddTitle: 'Add to playlist and play',
            onlineAdded: 'Added',
            onlineServerNetease: 'NetEase',
            onlineServerTencent: 'QQ Music',
            onlineServerKugou: 'Kugou',
        }
    };

    // 当前语言
    // 修改 i18n.js 中的 currentLang 初始化部分
    let currentLang = localStorage.getItem('lang') || getDefaultLang();

    /**
     * 根据时区和浏览器语言推断默认语言
     * @returns {string} 语言代码
     */
    function getDefaultLang() {
        // 优先使用浏览器语言
        const browserLang = navigator.language || navigator.userLanguage;

        // 中文相关语言代码
        if (browserLang.startsWith('zh')) {
            return 'zh';
        }

        if (browserLang.startsWith('en')) {
            return 'en';
        }

        // 通过时区判断(中国时区为 UTC+8)
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const chinaTimezones = ['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Urumqi', 'Asia/Hong_Kong', 'Asia/Taipei'];

        if (chinaTimezones.includes(timezone)) {
            return 'zh';
        }

        return 'en';
    }


    /**
     * 获取翻译文本
     * @param {string} key - 翻译键
     * @param {Object} [params] - 可选的占位符替换，形如 {name: 'x'}；
     *   翻译值里的 {name} 会被替换。未提供时原样返回占位符。
     * @returns {string} 翻译后的文本
     */
    function t(key, params) {
        // currentLang 来自 localStorage，没有校验：若存着未知语言代码，
        // translations[currentLang] 为 undefined，取属性会抛 TypeError。
        // 一次抛出会中断 updatePageTexts 整段循环，页面半翻译且不刷新
        // documentElement.lang——回退到 en 更稳妥。
        const dict = translations[currentLang] || translations['en'];
        let text = dict[key] || translations['en'][key] || key;
        if (params && typeof params === 'object') {
            text = text.replace(/\{(\w+)\}/g, (match, name) =>
                Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
            );
        }
        return text;
    }

    /**
     * 更新页面所有文本
     */
    function updatePageTexts() {
        // 更新 data-i18n 属性的元素
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                el.textContent = t(key);
            }
        });

        // 更新 placeholder
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) {
                el.placeholder = t(key);
            }
        });

        // 更新 title 属性
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (key) {
                el.title = t(key);
            }
        });

        // 更新 html lang 属性
        document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';

        // 更新语言切换按钮标签
        const langLabel = document.getElementById('lang-label');
        if (langLabel) {
            langLabel.textContent = currentLang === 'zh' ? 'EN' : '中';
        }
    }

    /**
     * 切换语言
     */
    function toggleLang() {
        currentLang = currentLang === 'zh' ? 'en' : 'zh';
        localStorage.setItem('lang', currentLang);
        updatePageTexts();
    }

    /**
     * 初始化
     */
    function init() {
        updatePageTexts();

        // 绑定语言切换按钮
        const langToggle = document.getElementById('lang-toggle');
        if (langToggle) {
            langToggle.addEventListener('click', toggleLang);
        }
    }

    // DOM 加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 导出 API（toggleLang 只在本模块内绑定按钮，无需导出）
    return {
        t,
        updatePageTexts
    };
})();
