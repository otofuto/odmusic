class MusicPlayer {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.source = null;
        this.audioBuffer = null;
        this.startTime = 0;
        this.pausedAt = 0;
        this.isPlaying = false;
        this.duration = 0;

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

        this.animationFrameId = null;

        this.setupEventListeners();
        this.stateChangeListeners = [];

        this.setupMediaSession();

        // iOS Safari での AudioContext の自動再開を設定
        document.addEventListener('touchstart', () => {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume().catch(error => {
                    console.warn('Failed to resume AudioContext after touch:', error);
                });
            }
        }, { once: false, passive: true });

        // 画面表示状態の変化を監視
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && 
                this.audioContext && 
                this.audioContext.state === 'suspended' && 
                this.isPlaying) {
                this.audioContext.resume().catch(error => {
                    console.warn('Failed to resume AudioContext on visibilitychange:', error);
                });
            }
        });

        // 画面のフォーカス変更を監視
        window.addEventListener('focus', () => {
            if (this.audioContext && 
                this.audioContext.state === 'suspended' && 
                this.isPlaying) {
                this.audioContext.resume().catch(error => {
                    console.warn('Failed to resume AudioContext on window focus:', error);
                });
            }
        });
    }

    async initialize() {
        if ('mediaSession' in navigator) {
            this.setupMediaSession();
            this._mediaSessionInitialized = true;
        }

        if (this.audioContext.state === 'suspended') {
            console.log('AudioContext is suspended. Will resume on user interaction.');
        }

        // iOS での自動再生ポリシーに対応するため、無音のバッファを作成して再生
        try {
            const silentBuffer = this.audioContext.createBuffer(1, 1, 22050);
            const source = this.audioContext.createBufferSource();
            source.buffer = silentBuffer;
            source.connect(this.audioContext.destination);
            source.start();
        } catch (e) {
            console.log('Silent buffer initialization failed:', e);
        }
    }

    setupEventListeners() {
        this.playPauseButton.addEventListener('click', () => this.togglePlayPause());
        this.loopModeButton.addEventListener('click', () => this.toggleLoopMode());
        this.nextMusicButton.addEventListener('click', () => this.handleTrackEnd());

        this.progressBar.addEventListener('click', (e) => {
            const rect = this.progressBar.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            this.seek(pos * this.duration);
        });
    }

    setupMediaSession() {
        if (!('mediaSession' in navigator) || this._mediaSessionInitialized) return;
        this._mediaSessionInitialized = true;

        if (!('mediaSession' in navigator)) return;

        try {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && 
                    this.audioContext && 
                    this.audioContext.state === 'suspended' && 
                    this.isPlaying) {
                    this.audioContext.resume().catch(err => console.error('Failed to resume audio context:', err));
                }
            });

            navigator.mediaSession.setActionHandler('play', () => {
                if (!this.isPlaying && this.audioBuffer) {
                    // AudioContextがサスペンド状態なら再開
                    if (this.audioContext.state === 'suspended') {
                        this.audioContext.resume().then(() => {
                            this.togglePlayPause();
                        }).catch(err => console.error('Failed to resume audio context:', err));
                    } else {
                        this.togglePlayPause();
                    }
                }
            });
    
            navigator.mediaSession.setActionHandler('pause', () => {
                if (this.isPlaying) {
                    this.togglePlayPause();
                }
            });
    
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                this.playPreviousTrack();
            });
    
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                this.handleTrackEnd();
            });
    
            navigator.mediaSession.setActionHandler('seekto', (details) => {
                if (details.seekTime !== undefined && this.audioBuffer) {
                    this.seek(details.seekTime);
                }
            });
    
            navigator.mediaSession.setActionHandler('seekbackward', (details) => {
                const skipTime = details.seekOffset || 10;
                if (this.audioBuffer) {
                    let currentTime;
                    if (this.isPlaying) {
                        currentTime = this.audioContext.currentTime - this.startTime + this.pausedAt;
                    } else {
                        currentTime = this.pausedAt;
                    }
                    this.seek(Math.max(0, currentTime - skipTime));
                }
            });
    
            navigator.mediaSession.setActionHandler('seekforward', (details) => {
                const skipTime = details.seekOffset || 10;
                if (this.audioBuffer) {
                    let currentTime;
                    if (this.isPlaying) {
                        currentTime = this.audioContext.currentTime - this.startTime + this.pausedAt;
                    } else {
                        currentTime = this.pausedAt;
                    }
                    this.seek(Math.min(this.duration, currentTime + skipTime));
                }
            });
        } catch {}
    }

    showLoading() {
        this.loadingIndicator.style.display = 'block';
    }

    hideLoading() {
        this.loadingIndicator.style.display = 'none';
    }

    updateProgress() {
        if (this.duration) {
            let currentTime;
            if (this.isPlaying) {
                currentTime = this.audioContext.currentTime - this.startTime + this.pausedAt;
            } else {
                currentTime = this.pausedAt;
            }

            if (currentTime > this.duration) {
                currentTime = this.duration;
            }

            const progress = (currentTime / this.duration) * 100;
            this.progressBarFill.style.width = `${progress}%`;

            if ('mediaSession' in navigator && (!this._lastPositionUpdate || Date.now() - this._lastPositionUpdate > 1000)) {
                navigator.mediaSession.setPositionState({
                    duration: this.duration,
                    playbackRate: 1.0,
                    position: currentTime
                });
                this._lastPositionUpdate = Date.now();
            }

            if (this.isPlaying && currentTime >= this.duration) {
                this.handleTrackEnd();
                return;
            }

            const timeRemaining = this.duration - currentTime;
            if (timeRemaining <= 10 && !this.isPreloading) {
                this.preloadNextTrack();
            }
        }

        if (this.isPlaying) {
            this.animationFrameId = requestAnimationFrame(() => this.updateProgress());
        }
    }

    async play(file, playlist = null) {
        if (playlist) {
            this.currentPlaylist = playlist;
            this.currentIndex = playlist.findIndex(item => item.id === file.id);
        } else {
            this.currentPlaylist = [file];
            this.currentIndex = 0;
        }

        this.pausedAt = 0;

        this.currentFileId = file.id;
        await this.loadAndPlayFile(file);
    }

    async loadAndPlayFile(file) {
        try {
            this.showLoading();
            let musicData = await db.getMusic(file.id);
            
            if (!musicData) {
                const blob = await auth.downloadFile(file.id);
                await db.saveMusic(file.id, blob);
                musicData = await db.getMusic(file.id);
            }

            const arrayBuffer = await musicData.blob.arrayBuffer();

            if (this.audioContext.state === 'suspended') {
                try {
                    await this.audioContext.resume();
                } catch (err) {
                    console.warn('Failed to resume AudioContext:', err);
                }
            }

            this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.duration = this.audioBuffer.duration;

            this.startPlayback();

            document.title = file.name.substring(0, file.name.lastIndexOf('.')) + ' - ODMusic';            
            this.currentTrackElement.textContent = file.name.substring(0, file.name.lastIndexOf('.'));
            this.playerElement.hidden = false;
            this.currentFileId = file.id;
            this.updatePlayPauseButton();
            this.isPreloading = false;
            this.hideLoading();

            let albumName = 'マイミュージック';
            if (this.currentPlaylist.length > 0 && this.currentPlaylist[0].albumName) {
                albumName = this.currentPlaylist[0].albumName;
            }

            if ('mediaSession' in navigator && !this._mediaSessionInitialized) {
                this.setupMediaSession();
                this._mediaSessionInitialized = true;
            }

            this.updateMediaSessionMetadata(file);

            this.notifyStateChange();
        } catch (error) {
            console.error('Error playing file:', error);
            this.hideLoading();
        }
    }

    startPlayback() {
        if (this.source) {
            this.source.stop();
            this.source = null;
        }

        this.source = this.audioContext.createBufferSource();
        this.source.buffer = this.audioBuffer;
        this.source.connect(this.audioContext.destination);

        this.source.loop = (this.loopMode === 'single');

        this.startTime = this.audioContext.currentTime;

        this.source.start(0, this.pausedAt);
        this.isPlaying = true;

        this.updateMediaSessionPlaybackState();

        this.updateProgress();
    }

    seek(time) {
        if (!this.audioBuffer) return;

        const wasPlaying = this.isPlaying;

        if (this.source) {
            this.source.stop();
            this.source = null;
        }

        this.pausedAt = Math.max(0, Math.min(time, this.duration));

        if (wasPlaying) {
            this.startPlayback();
        } else {
            this.updateProgress();
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
                console.log('Preloading next track:', nextFile.name);
                const blob = await auth.downloadFile(nextFile.id);
                await db.saveMusic(nextFile.id, blob);
            }
        } catch (error) {
            console.error('Error preloading next track:', error);
        } finally {
            this.isPreloading = false;
        }
    }

    togglePlayPause() {
        if (!this.audioBuffer) return;

        if (this.isPlaying) {
            if (this.source) {
                const currentTime = this.audioContext.currentTime - this.startTime + this.pausedAt;
                this.pausedAt = Math.min(currentTime, this.duration);
                this.source.stop();
                this.source = null;
            }
            this.isPlaying = false;

            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
        } else {
            this.startPlayback();
        }

        this.updatePlayPauseButton();
        this.updateMediaSessionPlaybackState();
        this.notifyStateChange();
    }

    updatePlayPauseButton() {
        const icon = !this.isPlaying ? 
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

        if (this.source) {
            this.source.loop = (this.loopMode === 'single');
        }
    }

    async handleTrackEnd() {
        if (this.loopMode === 'single') {
            return;
        }

        let nextIndex = this.currentIndex + 1;
        
        if (nextIndex >= this.currentPlaylist.length) {
            if (this.loopMode === 'all') {
                nextIndex = 0;
            } else {
                if (this.source) {
                    this.source.stop();
                    this.source = null;
                }
                this.isPlaying = false;
                this.pausedAt = 0;
                this.updatePlayPauseButton();
                this.updateMediaSessionPlaybackState();

                if (this.animationFrameId) {
                    cancelAnimationFrame(this.animationFrameId);
                    this.animationFrameId = null;
                }
                return;
            }
        }

        this.isPlaying = false;
        this.pausedAt = 0;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.currentIndex = nextIndex;
        await this.loadAndPlayFile(this.currentPlaylist[this.currentIndex]);
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
            callback(this.currentFileId, this.isPlaying);
        }
    }

    updateMediaSessionMetadata(file) {
        if ('mediaSession' in navigator) {
            const trackTitle = file.name.substring(0, file.name.lastIndexOf('.'));

            const baseUrl = window.location.origin;

            navigator.mediaSession.metadata = new MediaMetadata({
                title: trackTitle,
                artist: 'ODMusic',
                album: albumName || 'マイミュージック',
                artwork: [
                    { src: `${baseUrl}/icon/icon-192.png`, sizes: '192x192', type: 'image/png' },
                    { src: `${baseUrl}/icon/icon-512.png`, sizes: '512x512', type: 'image/png' }
                ]
            });
        }
    }

    updateMediaSessionPlaybackState() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
        }
    }

    async playPreviousTrack() {
        if (this.currentPlaylist.length <= 1) {
            // プレイリストに1曲しかない場合は最初から再生
            this.seek(0);
            return;
        }
    
        let prevIndex = this.currentIndex - 1;
        if (prevIndex < 0) {
            if (this.loopMode === 'all') {
                prevIndex = this.currentPlaylist.length - 1;
            } else {
                // ループモードがない場合は最初から再生
                this.seek(0);
                return;
            }
        }
    
        this.isPlaying = false;
        this.pausedAt = 0;
    
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    
        this.currentIndex = prevIndex;
        await this.loadAndPlayFile(this.currentPlaylist[this.currentIndex]);
    }
}

const player = new MusicPlayer();