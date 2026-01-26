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
            dragDropSubHint: '支持单个或多个文件 · 选择后自动播放',
            prev: '上一曲',
            play: '播放',
            pause: '暂停',
            next: '下一曲',
            shuffle: '随机',
            loop: '循环',
            pitch: '变调',
            pitchHint: '建议 ±2 范围',
            speed: '变速',
            noMatch: '无匹配歌曲'
        },
        'en': {
            selectFolder: 'Select Folder',
            selectFile: 'Select File',
            searchPlaceholder: 'Search songs...',
            dragDropHint: 'Drop audio files here',
            dragDropSubHint: 'Single or multiple files · Auto-play on select',
            prev: 'Prev',
            play: 'Play',
            pause: 'Pause',
            next: 'Next',
            shuffle: 'Shuffle',
            loop: 'Loop',
            pitch: 'Pitch',
            pitchHint: 'Suggest ±2 range',
            speed: 'Speed',
            noMatch: 'No matching songs'
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
     * @returns {string} 翻译后的文本
     */
    function t(key) {
        return translations[currentLang][key] || translations['en'][key] || key;
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
     * 获取当前语言
     * @returns {string} 当前语言代码
     */
    function getLang() {
        return currentLang;
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

    // 导出 API
    return {
        t,
        getLang,
        toggleLang,
        updatePageTexts
    };
})();
