/**
 * 所有音乐数据均来自第三方平台，不在本服务器存储任何音频文件。请在获取后 24 小时内删除，切勿用于商业或违法用途。
 */

let SecretPlayer = (function () {
    // ========== 配置 ==========
    const CONFIG = {
        API_BASE: 'https://api.baka.plus/meting/',
        MAX_RETRY: 2,
        RETRY_DELAY: 1000,
        SECRET_KEY: 'm',
        SECRET_COUNT: 7,
        KEY_TIMEOUT: 1000,
        DEFAULT_SERVER: 'netease',
        // 音质降级顺序：Hi-Res -> 无损 -> 极高 -> 标准
        BR_FALLBACK: [400, 380, 320, 128],
        DB_NAME: 'SecretPlayerCache',
        DB_STORE: 'audioCache',
        DB_VERSION: 1,
        // 缓存配置
        CACHE_MAX_AGE: 7 * 24 * 60 * 60 * 1000, // 缓存保留 7 天
        CACHE_MAX_SIZE: 500 * 1024 * 1024, // 最大缓存 500MB
    };

    // ========== 状态 ==========
    let state = {
        unlocked: false,
        keyPressCount: 0,
        lastKeyTime: 0,
        panelVisible: false,
        searchResults: [],
        currentPlayingIndex: -1,
        isPlaying: false,
        isLoading: false,
        searchHistory: [],
        db: null, // IndexedDB 实例
    };

    // ========== DOM 元素缓存 ==========
    let elements = {};

    // ========== IndexedDB 缓存管理 ==========
    function initDB() {
        return new Promise((resolve, reject) => {
            if (state.db) {
                resolve(state.db);
                return;
            }
            const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(CONFIG.DB_STORE)) {
                    const store = db.createObjectStore(CONFIG.DB_STORE, {keyPath: 'id'});
                    store.createIndex('timestamp', 'timestamp', {unique: false});
                }
                // 新增：封面缓存存储
                if (!db.objectStoreNames.contains('coverCache')) {
                    db.createObjectStore('coverCache', {keyPath: 'id'});
                }
            };
            request.onsuccess = (e) => {
                state.db = e.target.result;
                resolve(state.db);
            };
            request.onerror = (e) => {
                console.error('IndexedDB init error:', e);
                reject(e);
            };
        });
    }

    // ========== 缓存清理管理 ==========
    // 清理过期的缓存（超过 CACHE_MAX_AGE 的数据）
    async function cleanupExpiredCache() {
        try {
            const db = await initDB();
            const now = Date.now();
            const expiredTime = now - CONFIG.CACHE_MAX_AGE;
            let deletedCount = 0;

            // 清理音频缓存
            await new Promise((resolve) => {
                const tx = db.transaction(CONFIG.DB_STORE, 'readwrite');
                const store = tx.objectStore(CONFIG.DB_STORE);
                const index = store.index('timestamp');
                const range = IDBKeyRange.upperBound(expiredTime);
                const request = index.openCursor(range);
                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        cursor.delete();
                        deletedCount++;
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                request.onerror = () => resolve();
            });

            // 清理封面缓存
            await new Promise((resolve) => {
                const tx = db.transaction('coverCache', 'readwrite');
                const store = tx.objectStore('coverCache');
                const request = store.openCursor();
                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        if (cursor.value.timestamp < expiredTime) {
                            cursor.delete();
                        }
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                request.onerror = () => resolve();
            });

            if (deletedCount > 0) {
                console.log(`[缓存清理] 删除了 ${deletedCount} 条过期缓存`);
            }
        } catch (e) {
            console.error('缓存清理失败:', e);
        }
    }

    // 获取当前缓存总大小
    async function getCacheSize() {
        try {
            const db = await initDB();
            let totalSize = 0;

            // 计算音频缓存大小
            await new Promise((resolve) => {
                const tx = db.transaction(CONFIG.DB_STORE, 'readonly');
                const store = tx.objectStore(CONFIG.DB_STORE);
                const request = store.getAll();
                request.onsuccess = (e) => {
                    const items = e.target.result;
                    totalSize += items.reduce((sum, item) => sum + (item.size || 0), 0);
                    resolve();
                };
                request.onerror = () => resolve();
            });

            // 计算封面缓存大小
            await new Promise((resolve) => {
                const tx = db.transaction('coverCache', 'readonly');
                const store = tx.objectStore('coverCache');
                const request = store.getAll();
                request.onsuccess = (e) => {
                    const items = e.target.result;
                    totalSize += items.reduce((sum, item) => sum + (item.size || 0), 0);
                    resolve();
                };
                request.onerror = () => resolve();
            });

            return totalSize;
        } catch {
            return 0;
        }
    }

    // 当缓存超过最大容量时，删除最旧的缓存
    async function cleanupBySize() {
        try {
            const currentSize = await getCacheSize();
            if (currentSize <= CONFIG.CACHE_MAX_SIZE) return;

            const db = await initDB();
            const targetFree = currentSize - CONFIG.CACHE_MAX_SIZE * 0.8; // 清理到 80% 容量

            await new Promise((resolve) => {
                const tx = db.transaction(CONFIG.DB_STORE, 'readwrite');
                const store = tx.objectStore(CONFIG.DB_STORE);
                const index = store.index('timestamp');
                const request = index.openCursor();
                let freedSize = 0;

                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor && freedSize < targetFree) {
                        freedSize += cursor.value.size || 0;
                        cursor.delete();
                        cursor.continue();
                    } else {
                        if (freedSize > 0) {
                            console.log(`[缓存清理] 释放了 ${(freedSize / 1024 / 1024).toFixed(2)} MB`);
                        }
                        resolve();
                    }
                };
                request.onerror = () => resolve();
            });
        } catch (e) {
            console.error('缓存大小清理失败:', e);
        }
    }

    // 清空所有缓存
    async function clearAllCache() {
        try {
            const db = await initDB();

            // 清空音频缓存
            await new Promise((resolve) => {
                const tx = db.transaction(CONFIG.DB_STORE, 'readwrite');
                const store = tx.objectStore(CONFIG.DB_STORE);
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
            });

            // 清空封面缓存
            await new Promise((resolve) => {
                const tx = db.transaction('coverCache', 'readwrite');
                const store = tx.objectStore('coverCache');
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
            });

            console.log('[缓存] 已清空所有缓存');
            return true;
        } catch (e) {
            console.error('清空缓存失败:', e);
            return false;
        }
    }

    function getCachedAudio(cacheKey) {
        return new Promise(async (resolve) => {
            try {
                const db = await initDB();
                const tx = db.transaction(CONFIG.DB_STORE, 'readonly');
                const store = tx.objectStore(CONFIG.DB_STORE);
                const request = store.get(cacheKey);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
    }

    function saveCachedAudio(cacheKey, blob, songInfo) {
        return new Promise(async (resolve) => {
            try {
                const db = await initDB();

                // 检查容量限制，如果超限则先清理
                const currentSize = await getCacheSize();
                if (currentSize + blob.size > CONFIG.CACHE_MAX_SIZE) {
                    console.warn('[缓存] 容量超限，正在清理旧缓存...');
                    await cleanupBySize();

                    // 再次检查是否仍然超限
                    const newSize = await getCacheSize();
                    if (newSize + blob.size > CONFIG.CACHE_MAX_SIZE) {
                        // 仍然超限，清理过期缓存后再试
                        await cleanupExpiredCache();
                    }
                }

                const tx = db.transaction(CONFIG.DB_STORE, 'readwrite');
                const store = tx.objectStore(CONFIG.DB_STORE);
                const entry = {
                    id: cacheKey,
                    blob: blob,
                    size: blob.size,
                    type: blob.type,
                    timestamp: Date.now(),
                    songInfo: songInfo,
                };
                store.put(entry);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch (e) {
                console.error('保存缓存失败:', e);
                resolve(false);
            }
        });
    }

    // ========== 封面缓存管理 ==========
    function getCachedCover(coverKey) {
        return new Promise(async (resolve) => {
            try {
                const db = await initDB();
                const tx = db.transaction('coverCache', 'readonly');
                const store = tx.objectStore('coverCache');
                const request = store.get(coverKey);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
    }

    function saveCachedCover(coverKey, blob) {
        return new Promise(async (resolve) => {
            try {
                const db = await initDB();
                const tx = db.transaction('coverCache', 'readwrite');
                const store = tx.objectStore('coverCache');
                const entry = {
                    id: coverKey,
                    blob: blob,
                    size: blob.size,
                    type: blob.type,
                    timestamp: Date.now(),
                };
                store.put(entry);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch {
                resolve(false);
            }
        });
    }

    function generateCacheKey(songId, server, br) {
        return `song_${server}_${songId}_${br}`;
    }

    function generateCoverKey(songId, server) {
        return `cover_${server}_${songId}`;
    }

    // 下载封面图片
    async function downloadCover(picUrl, songId, server) {
        const coverKey = generateCoverKey(songId, server);

        // 先检查缓存
        const cached = await getCachedCover(coverKey);
        if (cached && cached.blob && cached.blob.size > 0) {
            console.log(`[封面缓存命中] ${songId}`);
            return {blob: cached.blob, fromCache: true};
        }

        // 没有缓存，下载
        try {
            const response = await fetch(picUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const blob = await response.blob();
            if (blob.size < 100) throw new Error('Cover too small');

            // 保存到缓存
            await saveCachedCover(coverKey, blob);
            console.log(`[封面已缓存] ${songId}`);

            return {blob, fromCache: false};
        } catch (e) {
            console.warn(`封面下载失败:`, e.message);
            return null;
        }
    }

    // ========== API 调用 ==========
    async function fetchAPI(params, retryCount = 0) {
        const url = CONFIG.API_BASE + '?' + new URLSearchParams(params).toString();
        try {
            const res = await fetch(url, {redirect: 'follow'});
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (e) {
            if (retryCount < CONFIG.MAX_RETRY) {
                await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY));
                return fetchAPI(params, retryCount + 1);
            }
            throw e;
        }
    }

    async function searchSongs(keyword, server = CONFIG.DEFAULT_SERVER) {
        const res = await fetchAPI({
            server: server,
            type: 'search',
            id: 0,
            keyword: keyword,
        });
        return await res.json();
    }

    // 带音质降级的音频URL获取
    async function getSongUrlWithFallback(songId, server = CONFIG.DEFAULT_SERVER) {
        const errors = [];
        for (const br of CONFIG.BR_FALLBACK) {
            try {
                const res = await fetchAPI({
                    server: server,
                    type: 'url',
                    id: songId,
                    br: br,
                });
                // 检查是否返回了有效的音频URL
                const audioUrl = res.url;
                if (!audioUrl || audioUrl.includes('.html') || audioUrl.includes('error')) {
                    throw new Error(`Invalid audio URL for br=${br}`);
                }
                return {url: audioUrl, br: br};
            } catch (e) {
                console.warn(`音质 ${br} 获取失败:`, e.message);
                errors.push({br, error: e.message});
            }
        }
        throw new Error(`所有音质均获取失败: ${errors.map(e => `${e.br}(${e.error})`).join(', ')}`);
    }

    // 下载音频文件到本地缓存
    async function downloadAndCache(songId, server, songInfo) {
        // 先检查所有音质的缓存
        for (const br of CONFIG.BR_FALLBACK) {
            const cacheKey = generateCacheKey(songId, server, br);
            const cached = await getCachedAudio(cacheKey);
            if (cached && cached.blob && cached.blob.size > 0) {
                console.log(`[缓存命中] ${songInfo.name || songId} @ ${br}kbps`);
                return {blob: cached.blob, br: br, fromCache: true};
            }
        }

        // 没有缓存，下载
        for (const br of CONFIG.BR_FALLBACK) {
            try {
                const {url: audioUrl} = await getSongUrlWithFallback(songId, server);
                console.log(`[下载中] ${songInfo.name || songId} @ ${br}kbps`);

                const response = await fetch(audioUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const blob = await response.blob();
                if (blob.size < 1000) throw new Error('File too small, likely not audio');

                const cacheKey = generateCacheKey(songId, server, br);
                await saveCachedAudio(cacheKey, blob, {...songInfo, br});

                return {blob, br, fromCache: false};
            } catch (e) {
                console.warn(`下载音质 ${br} 失败:`, e.message);
            }
        }
        throw new Error('所有音质下载均失败');
    }

    // 从搜索结果的url字段解析歌曲ID
    function parseSongIdFromUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.searchParams.get('id');
        } catch {
            return null;
        }
    }

    // ========== 与主播放器通信 ==========
    function getMainPlayer() {
        // 通过全局变量访问主播放器的函数
        if (window.MainPlayer && window.MainPlayer.playOnlineSong) {
            return window.MainPlayer;
        }
        return null;
    }

    // ========== UI 构建 ==========
    function buildPanel() {
        const panel = document.createElement('div');
        panel.id = 'secret-panel';
        panel.className = 'secret-panel';
        panel.innerHTML = `
            <div class="secret-panel-overlay"></div>
            <div class="secret-panel-container">
                <div class="secret-panel-header">
                    <div class="secret-panel-title">
                        <i class="fa-solid fa-music"></i>
                        <span>在线音乐</span>
                    </div>
                    <div class="secret-panel-controls">
                        <select id="secret-server" class="secret-select">
                            <option value="netease">网易云</option>
                            <option value="tencent">QQ音乐</option>
                            <option value="kugou">酷狗</option>
                        </select>
                        <button id="secret-close" class="secret-btn-icon" title="关闭">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>
                <div class="secret-search-box">
                    <input type="text" id="secret-search-input" placeholder="搜索歌曲、歌手..." autocomplete="off">
                    <button id="secret-search-btn" class="secret-btn">
                        <i class="fa-solid fa-search"></i>
                    </button>
                </div>
                <div class="secret-content">
                    <div id="secret-loading" class="secret-loading hidden">
                        <i class="fa-solid fa-spinner fa-spin"></i>
                        <span>搜索中...</span>
                    </div>
                    <div id="secret-download-status" class="secret-download-status hidden">
                        <i class="fa-solid fa-download"></i>
                        <span id="secret-download-text">准备下载...</span>
                        <div class="secret-download-progress">
                            <div id="secret-download-progress-bar" class="secret-download-progress-bar"></div>
                        </div>
                    </div>
                    <div id="secret-empty" class="secret-empty">
                        <i class="fa-solid fa-compact-disc"></i>
                        <p>搜索你喜欢的音乐</p>
                        <p class="secret-hint">支持网易云、QQ音乐、酷狗</p>
                        <p class="secret-hint">点击歌曲将添加到主播放列表</p>
                    </div>
                    <div id="secret-results" class="secret-results hidden"></div>
                    <div id="secret-error" class="secret-error hidden"></div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);
        cacheElements();
        bindPanelEvents();
    }

    function cacheElements() {
        elements = {
            panel: document.getElementById('secret-panel'),
            overlay: document.querySelector('.secret-panel-overlay'),
            container: document.querySelector('.secret-panel-container'),
            closeBtn: document.getElementById('secret-close'),
            serverSelect: document.getElementById('secret-server'),
            searchInput: document.getElementById('secret-search-input'),
            searchBtn: document.getElementById('secret-search-btn'),
            loading: document.getElementById('secret-loading'),
            downloadStatus: document.getElementById('secret-download-status'),
            downloadText: document.getElementById('secret-download-text'),
            downloadProgressBar: document.getElementById('secret-download-progress-bar'),
            empty: document.getElementById('secret-empty'),
            results: document.getElementById('secret-results'),
            error: document.getElementById('secret-error'),
        };
    }

    function bindPanelEvents() {
        // 关闭
        elements.closeBtn.addEventListener('click', hidePanel);
        elements.overlay.addEventListener('click', hidePanel);

        // 搜索
        elements.searchBtn.addEventListener('click', performSearch);
        elements.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') performSearch();
        });
    }

    // ========== 搜索功能 ==========
    async function performSearch() {
        const keyword = elements.searchInput.value.trim();
        if (!keyword) return;

        const server = elements.serverSelect.value;

        showLoading(true);
        hideError();
        elements.empty.classList.add('hidden');
        elements.results.classList.add('hidden');

        try {
            const results = await searchSongs(keyword, server);
            state.searchResults = results;
            state.currentPlayingIndex = -1;

            if (!results || results.length === 0) {
                showError('没有找到相关歌曲');
                elements.empty.classList.remove('hidden');
            } else {
                renderResults(results);
            }
        } catch (e) {
            showError('搜索失败，请稍后重试');
            console.error('Search error:', e);
        } finally {
            showLoading(false);
        }
    }

    function renderResults(results) {
        elements.results.innerHTML = '';
        elements.results.classList.remove('hidden');

        results.forEach((song, index) => {
            const item = document.createElement('div');
            item.className = 'secret-result-item';
            item.dataset.index = index;

            const title = song.name || song.title || '未知';
            const artist = song.artist || song.author || '未知';
            const album = song.album || '';
            const pic = song.pic || song.cover || '';

            item.innerHTML = `
                <div class="secret-result-cover">
                    ${pic ? `<img src="${pic}" alt="" loading="lazy">` : '<i class="fa-solid fa-music"></i>'}
                </div>
                <div class="secret-result-info">
                    <div class="secret-result-title" title="${title}">${title}</div>
                    <div class="secret-result-artist" title="${artist}">${artist}</div>
                    ${album ? `<div class="secret-result-album" title="${album}">${album}</div>` : ''}
                </div>
                <div class="secret-result-actions">
                    <button class="secret-btn-icon add-btn" title="添加到播放列表并播放">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </div>
            `;

            // 点击添加到播放列表并播放
            item.querySelector('.add-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                addSongToPlaylist(index);
            });

            // 点击整行也可以添加
            item.addEventListener('click', () => addSongToPlaylist(index));

            elements.results.appendChild(item);
        });
    }

    // ========== 添加到主播放列表 ==========
    async function addSongToPlaylist(index) {
        if (index < 0 || index >= state.searchResults.length) return;

        const song = state.searchResults[index];
        const server = elements.serverSelect.value;
        const mainPlayer = getMainPlayer();

        if (!mainPlayer) {
            showError('主播放器未就绪，请稍后重试');
            return;
        }

        // 解析歌曲ID
        const songId = parseSongIdFromUrl(song.url);
        if (!songId) {
            showError('无法解析歌曲ID');
            return;
        }

        showDownloadStatus(true);
        updateDownloadProgress(5, '准备下载...');

        try {
            // 并行下载音频和封面
            const coverUrl = song.pic || song.cover || '';

            // 先下载封面（如果有的话）
            let coverBlob = null;
            if (coverUrl) {
                updateDownloadProgress(10, '正在获取封面...');
                const coverResult = await downloadCover(coverUrl, songId, server);
                if (coverResult) {
                    coverBlob = coverResult.blob;
                }
            }

            updateDownloadProgress(30, '正在获取音频...');

            // 下载并缓存音频
            const {blob, br, fromCache} = await downloadAndCache(songId, server, {
                name: song.name || song.title || '未知',
                artist: song.artist || song.author || '未知',
                album: song.album || '',
                pic: coverUrl,
            });

            updateDownloadProgress(80, fromCache ? '从缓存加载...' : '正在处理...');

            // 创建 File 对象（使用 blob）
            const fileName = `${song.name || song.title || 'unknown'}_${song.artist || 'unknown'}.mp3`;
            const file = new File([blob], fileName, {type: blob.type || 'audio/mpeg'});

            updateDownloadProgress(100, '添加到播放列表...');

            // 构建歌曲数据
            const songData = {
                name: fileName,
                file: file,
                size: blob.size,
                isOnline: true,
                coverBlob: coverBlob, // 新增：传递封面 blob
                onlineInfo: {
                    id: songId,
                    server: server,
                    br: br,
                    originalName: song.name || song.title || '未知',
                    artist: song.artist || song.author || '未知',
                    album: song.album || '',
                    pic: coverUrl,
                }
            };

            // 调用主播放器的方法添加并播放
            mainPlayer.playOnlineSong(songData);

            // 高亮当前添加的歌曲
            highlightAddedItem(index);

            // 关闭面板
            setTimeout(() => {
                hidePanel();
            }, 500);

        } catch (e) {
            showError('添加失败: ' + e.message);
            console.error('Add to playlist error:', e);
        } finally {
            showDownloadStatus(false);
        }
    }

    function highlightAddedItem(index) {
        const items = elements.results.querySelectorAll('.secret-result-item');
        items.forEach((item, i) => {
            if (i === index) {
                item.classList.add('added');
                const btn = item.querySelector('.add-btn');
                if (btn) {
                    btn.innerHTML = '<i class="fa-solid fa-check"></i>';
                    btn.title = '已添加';
                }
            }
        });
    }

    // ========== UI 更新 ==========
    function showLoading(show) {
        elements.loading.classList.toggle('hidden', !show);
    }

    function showDownloadStatus(show) {
        if (elements.downloadStatus) {
            elements.downloadStatus.classList.toggle('hidden', !show);
        }
    }

    function updateDownloadProgress(percent, text) {
        if (elements.downloadProgressBar) {
            elements.downloadProgressBar.style.width = `${percent}%`;
        }
        if (elements.downloadText && text) {
            elements.downloadText.textContent = text;
        }
    }

    function showError(msg) {
        elements.error.textContent = msg;
        elements.error.classList.remove('hidden');
    }

    function hideError() {
        elements.error.classList.add('hidden');
    }

    // ========== 面板显示/隐藏 ==========
    function showPanel() {
        if (!elements.panel) buildPanel();
        elements.panel.classList.add('visible');
        state.panelVisible = true;
        setTimeout(() => elements.searchInput.focus(), 300);
    }

    function hidePanel() {
        if (elements.panel) {
            elements.panel.classList.remove('visible');
        }
        state.panelVisible = false;
    }

    function togglePanel() {
        if (state.panelVisible) {
            hidePanel();
        } else {
            showPanel();
        }
    }

    // ========== 秘密激活 ==========
    function handleSecretKeyPress(key) {
        const now = Date.now();

        if (key === CONFIG.SECRET_KEY) {
            // 检查是否在超时时间内
            if (now - state.lastKeyTime > CONFIG.KEY_TIMEOUT) {
                state.keyPressCount = 0;
            }

            state.keyPressCount++;
            state.lastKeyTime = now;

            // 达到次数，解锁
            if (state.keyPressCount >= CONFIG.SECRET_COUNT) {
                state.keyPressCount = 0;
                if (!state.unlocked) {
                    state.unlocked = true;
                    showPanel();
                } else {
                    togglePanel();
                }
            }
        } else {
            state.keyPressCount = 0;
        }
    }

    // ========== 工具函数 ==========
    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // ========== 初始化 ==========
    function init() {
        // 初始化 IndexedDB 并执行缓存清理
        initDB()
            .then(() => {
                // 启动时清理过期缓存
                cleanupExpiredCache();
                // 检查并清理超出容量限制的缓存
                cleanupBySize();
            })
            .catch(console.error);

        // 监听全局键盘事件
        document.addEventListener('keydown', (e) => {
            // 如果面板已显示，ESC 关闭
            if (e.key === 'Escape' && state.panelVisible) {
                hidePanel();
                return;
            }

            // 如果焦点在搜索框内，不处理秘密按键
            if (elements.searchInput && document.activeElement === elements.searchInput) return;

            // 处理秘密按键
            handleSecretKeyPress(e.key.toLowerCase());
        });
    }

    // DOM 加载完成后初始化并构建面板
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            buildPanel();
            init();
        });
    } else {
        buildPanel();
        init();
    }

    // 导出到全局，供 main.js 使用
    window.SecretPlayer = {
        show: showPanel,
        hide: hidePanel,
        toggle: togglePanel,
        isVisible: () => state.panelVisible,
        // 缓存管理 API
        clearCache: clearAllCache,
        getCacheSize: getCacheSize,
        cleanupCache: cleanupExpiredCache,
    };

    // 导出（调试用）
    return window.SecretPlayer;
})();
