class MusicPlayer {
    constructor() {
        this.audio = document.getElementById('audioPlayer');
        this.playPauseButton = document.getElementById('playPause');
        this.loopModeButton = document.getElementById('loopMode');
        this.nextMusicButton = document.getElementById('nextMusic');
        this.currentTrackElement = document.getElementById('currentTrack');
        this.playerElement = document.getElementById('player');
        this.progressBar = document.getElementById('progressBar');
        this.progressBarFill = document.getElementById('progressBarFill');
        this.loadingIndicator = document.getElementById('loadingIndicator');
        
        this.currentPlaylist = [];
        this.currentIndex = -1;
        this.loopMode = 'none'; // none, single, all
        this.currentFileId = null;
        this.isPreloading = false;
        this.currentTrackInfo = null;

        this.setupEventListeners();
        this.setupMediaSession();
        this.stateChangeListeners = [];
    }

    async initialize() {
    }

    setupEventListeners() {
        this.playPauseButton.addEventListener('click', () => this.togglePlayPause());
        this.loopModeButton.addEventListener('click', () => this.toggleLoopMode());
        this.nextMusicButton.addEventListener('click', () => this.handleTrackEnd());

        this.audio.addEventListener('ended', () => this.handleTrackEnd());
        this.audio.addEventListener('error', (e) => {
            console.error('オーディオエラー:', e);
            this.hideLoading();
            app.showNotification('音楽ファイルの再生中にエラーが発生しました', 3000);
        });
        
        this.audio.addEventListener('play', () => {
            this.updatePlayPauseButton();
            // MediaSessionの再生状態も更新
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'playing';
            }
        });
        
        this.audio.addEventListener('pause', () => {
            this.updatePlayPauseButton();
            // MediaSessionの再生状態も更新
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'paused';
            }
        });
        
        this.audio.addEventListener('timeupdate', () => {
            this.updateProgress();
            this.updateMediaSessionPositionState();
        });
        
        this.audio.addEventListener('loadstart', () => this.showLoading());
        this.audio.addEventListener('canplay', () => this.hideLoading());

        this.progressBar.addEventListener('click', (e) => {
            const rect = this.progressBar.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            if (this.audio.readyState > 0) {
                this.audio.currentTime = pos * this.audio.duration;
                this.updateMediaSessionPositionState();
            }
        });
    }

    setupMediaSession() {
        if (!('mediaSession' in navigator)) {
            return;
        }
        
        // 再生・一時停止のアクションハンドラを設定
        try {
            navigator.mediaSession.setActionHandler('play', () => {
                this.audio.play().catch(error => {
                    console.error('再生開始エラー:', error);
                });
                this.updatePlayPauseButton();
                this.notifyStateChange();
            });
        } catch (error) {
            console.log('play アクションはサポートされていません');
        }
        
        try {    
            navigator.mediaSession.setActionHandler('pause', () => {
                this.audio.pause();
                this.updatePlayPauseButton();
                this.notifyStateChange();
            });
        } catch (error) {
            console.log('pause アクションはサポートされていません');
        }
        
        try {
            // 次の曲へのアクションハンドラ
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                this.handleTrackEnd();
            });
        } catch (error) {
            console.log('nexttrack アクションはサポートされていません');
        }
        
        try {
            // 前の曲へのアクションハンドラ
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                this.playPrevious();
            });
        } catch (error) {
            console.log('previoustrack アクションはサポートされていません');
        }
        
        try {
            // シーク機能の追加
            navigator.mediaSession.setActionHandler('seekto', (details) => {
                if (details.fastSeek && 'fastSeek' in this.audio) {
                    this.audio.fastSeek(details.seekTime);
                    return;
                }
                this.audio.currentTime = details.seekTime;
                this.updateProgress();
                this.updateMediaSessionPositionState();
            });
        } catch (error) {
            console.log('seekto アクションはサポートされていません');
        }
    }

    // MediaSessionのメタデータを更新する関数
    updateMediaSessionMetadata() {
        if (!('mediaSession' in navigator) || !this.currentTrackInfo) {
            return;
        }

        try {
            // ファイル名から拡張子を除去（拡張子がない場合は元の名前を使用）
            let title = this.currentTrackInfo.name || 'Unknown';
            const extIndex = title.lastIndexOf('.');
            if (extIndex > 0) { // -1でなく、かつ先頭文字でもない場合
                title = title.substring(0, extIndex);
            }
            
            navigator.mediaSession.metadata = new MediaMetadata({
                title: title,
                artist: '',
                album: '',
                artwork: [
                    { src: '/icon/icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/icon/icon-512.png', sizes: '512x512', type: 'image/png' },
                ]
            });
        } catch (error) {
            console.error('MediaSessionメタデータの設定エラー:', error);
        }
    }

    // 前の曲を再生する関数
    async playPrevious() {
        if (this.currentIndex <= 0) {
            if (this.loopMode === 'all' && this.currentPlaylist.length > 0) {
                this.currentIndex = this.currentPlaylist.length - 1;
            } else {
                // 現在の曲の最初に戻る
                this.audio.currentTime = 0;
                return;
            }
        } else {
            this.currentIndex--;
        }
        
        if (this.currentPlaylist[this.currentIndex]) {
            await this.loadAndPlayFile(this.currentPlaylist[this.currentIndex]);
        }
    }

    // 再生位置情報を更新する関数
    updateMediaSessionPositionState() {
        if (!('mediaSession' in navigator) || !this.audio || !this.audio.duration) {
            return;
        }

        try {
            if (navigator.mediaSession.setPositionState) {
                navigator.mediaSession.setPositionState({
                    duration: this.audio.duration,
                    playbackRate: this.audio.playbackRate,
                    position: this.audio.currentTime
                });
            }
        } catch (error) {
            console.error('MediaSession位置情報の設定エラー:', error);
        }
    }

    showLoading() {
        this.loadingIndicator.style.display = 'block';
    }

    hideLoading() {
        this.loadingIndicator.style.display = 'none';
    }

    updateProgress() {
        if (this.audio.duration) {
            const progress = (this.audio.currentTime / this.audio.duration) * 100;
            this.progressBarFill.style.width = `${progress}%`;

            const timeRemaining = this.audio.duration - this.audio.currentTime;
            if (timeRemaining <= 10 && !this.isPreloading) {
                this.preloadNextTrack();
            }
        }
    }

    async play(file, playlist = null) {
        if (!file || !file.id) {
            console.error('無効なファイル情報です', file);
            return;
        }
        
        if (playlist && Array.isArray(playlist) && playlist.length > 0) {
            this.currentPlaylist = playlist;
            this.currentIndex = playlist.findIndex(item => item && item.id === file.id);
            // 見つからない場合は先頭に設定
            if (this.currentIndex < 0) {
                this.currentIndex = 0;
            }
        } else {
            this.currentPlaylist = [file];
            this.currentIndex = 0;
        }

        this.currentFileId = file.id;
        this.currentTrackInfo = file;
        await this.loadAndPlayFile(file);
    }

    async loadAndPlayFile(file) {
        if (!file || !file.id) {
            console.error('無効なファイル情報です', file);
            this.hideLoading();
            return;
        }
        
        try {
            this.showLoading();
            let musicData = await db.getMusic(file.id);
            
            if (!musicData) {
                const blob = await auth.downloadFile(file);
                await db.saveMusic(file.id, blob);
                musicData = await db.getMusic(file.id);
            }

            const url = URL.createObjectURL(musicData.blob);
            this.audio.src = url;
            
            // audio.playはPromiseを返すのでエラーをキャッチする
            this.audio.play().catch(error => {
                console.error('再生開始エラー:', error);
            });
            
            // ファイル名から拡張子を除去（拡張子がない場合は元の名前を使用）
            let title = file.name || '';
            const extIndex = title.lastIndexOf('.');
            if (extIndex > 0) {
                title = title.substring(0, extIndex);
            }
            
            document.title = title + ' - ODMusic';
            this.currentTrackElement.textContent = title;
            
            this.playerElement.hidden = false;
            this.currentFileId = file.id;
            this.currentTrackInfo = file;
            this.updatePlayPauseButton();
            this.isPreloading = false;

            // MediaSessionメタデータを更新
            this.updateMediaSessionMetadata();
            
            this.notifyStateChange();

            this.hideLoading();
        } catch (error) {
            console.error('ファイル再生エラー:', error);
            this.hideLoading();
        }
    }

    async preloadNextTrack() {
        if (this.isPreloading || this.loopMode === 'single') {
            return;
        }

        let nextIndex = this.currentIndex + 1;
        if (nextIndex >= this.currentPlaylist.length) {
            if (this.loopMode === 'all') {
                nextIndex = 0;
            } else {
                return;
            }
        }

        const nextFile = this.currentPlaylist[nextIndex];
        if (!nextFile) {
            return;
        }

        try {
            this.isPreloading = true;
            let musicData = await db.getMusic(nextFile.id);
            
            if (!musicData) {
                console.log('次のトラックをプリロード中:', nextFile.name);
                const blob = await auth.downloadFile(nextFile);
                await db.saveMusic(nextFile.id, blob);
            }
        } catch (error) {
            console.error('次のトラックのプリロードエラー:', error);
        } finally {
            this.isPreloading = false;
        }
    }

    togglePlayPause() {
        if (this.audio.paused) {
            this.audio.play();
        } else {
            this.audio.pause();
        }
        this.updatePlayPauseButton();
        this.notifyStateChange();
    }

    updatePlayPauseButton() {
        const icon = this.audio.paused ? 
            '<path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z"/>' :
            '<path fill="currentColor" d="M14,19H18V5H14M6,19H10V5H6V19Z"/>';
        
        this.playPauseButton.querySelector('svg').innerHTML = icon;
    }

    toggleLoopMode() {
        const modes = ['none', 'single', 'all'];
        const currentIndex = modes.indexOf(this.loopMode);
        this.loopMode = modes[(currentIndex + 1) % modes.length];
        
        const icons = {
            none: 'M17,17H7V14L3,18L7,22V19H19V13H17M7,7H17V10L21,6L17,2V5H5V11H7V7M3,3L21,21L19.5,22.5L1.5,4.5L3,3Z',
            single: 'M17,17H7V14L3,18L7,22V19H19V13H17M7,7H17V10L21,6L17,2V5H5V11H7V7M13,15V9H12L10,10V11H11.5V15H13Z',
            all: 'M17,17H7V14L3,18L7,22V19H19V13H17M7,7H17V10L21,6L17,2V5H5V11H7V7Z'
        };
        
        this.loopModeButton.querySelector('svg path').setAttribute('d', icons[this.loopMode]);
    }

    async handleTrackEnd() {
        if (this.loopMode === 'single') {
            this.audio.play().catch(error => {
                console.error('リピート再生エラー:', error);
            });
            return;
        }

        let nextIndex = this.currentIndex + 1;
        
        if (nextIndex >= this.currentPlaylist.length) {
            if (this.loopMode === 'all') {
                nextIndex = 0;
            } else {
                // プレイリストの最後に達した場合は何もしない
                return;
            }
        }

        this.currentIndex = nextIndex;
        
        // プレイリストが有効かチェック
        if (this.currentPlaylist.length > 0 && this.currentPlaylist[this.currentIndex]) {
            await this.loadAndPlayFile(this.currentPlaylist[this.currentIndex]);
        }
    }

    getCurrentFileId() {
        return this.currentFileId;
    }

    addStateChangeListener(callback) {
        this.stateChangeListeners.push(callback);
    }

    removeStateChangeListener(callback) {
        this.stateChangeListeners = this.stateChangeListeners.filter(lis => lis !== callback);
    }

    notifyStateChange() {
        for (const callback of this.stateChangeListeners) {
            callback(this.currentFileId, !this.audio.paused);
        }
    }
}

const player = new MusicPlayer();