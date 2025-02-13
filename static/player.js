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

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.playPauseButton.addEventListener('click', () => this.togglePlayPause());
        this.loopModeButton.addEventListener('click', () => this.toggleLoopMode());
        this.nextMusicButton.addEventListener('click', () => this.handleTrackEnd());
        
        this.audio.addEventListener('ended', () => this.handleTrackEnd());
        this.audio.addEventListener('error', (e) => this.handleError(e));
        this.audio.addEventListener('play', () => this.updatePlayPauseButton());
        this.audio.addEventListener('pause', () => this.updatePlayPauseButton());
        this.audio.addEventListener('timeupdate', () => {
            this.updateProgress();
            this.checkPreloadNext();
        });
        this.audio.addEventListener('loadstart', () => this.showLoading());
        this.audio.addEventListener('canplay', () => this.hideLoading());

        this.progressBar.addEventListener('click', (e) => {
            const rect = this.progressBar.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            this.audio.currentTime = this.audio.duration * pos;
        });
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

            const url = URL.createObjectURL(musicData.blob);
            this.audio.src = url;
            this.audio.play();
            document.title = file.name.substring(0, file.name.lastIndexOf('.')) + ' - ODMusic';
            
            this.currentTrackElement.textContent = file.name.substring(0, file.name.lastIndexOf('.'));
            this.playerElement.hidden = false;
            this.currentFileId = file.id;
            this.updatePlayPauseButton();
            this.isPreloading = false;
        } catch (error) {
            console.error('Error playing file:', error);
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

    checkPreloadNext() {
        if (!this.audio.duration) {
            return;
        }

        const timeRemaining = this.audio.duration - this.audio.currentTime;
        if (timeRemaining <= 10 && !this.isPreloading) {
            this.preloadNextTrack();
        }
    }

    togglePlayPause() {
        if (this.audio.paused) {
            this.audio.play();
        } else {
            this.audio.pause();
        }
        this.updatePlayPauseButton();
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
            this.audio.play();
            return;
        }

        if (this.loopMode === 'all' && this.currentIndex === this.currentPlaylist.length - 1) {
            this.currentIndex = -1;
        }

        if (this.currentIndex < this.currentPlaylist.length - 1) {
            this.currentIndex++;
            await this.loadAndPlayFile(this.currentPlaylist[this.currentIndex]);
        }
    }

    handleError(error) {
        console.error('Audio playback error:', error);
        this.hideLoading();
    }

    getCurrentFileId() {
        return this.currentFileId;
    }
}

const player = new MusicPlayer();