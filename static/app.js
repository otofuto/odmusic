class App {
    constructor() {
        this.currentFolderId = null;
        this.pathStack = [];
        this.currentAlbum = null;
        this.addToAlbumMode = false;
        this.selectedFile = null;

        this.fileList = document.getElementById('fileList');
        this.backButton = document.getElementById('backButton');
        this.currentPath = document.getElementById('currentPath');
        this.albumButton = document.getElementById('albumButton');
        this.albumModal = document.getElementById('albumModal');
        this.newAlbumName = document.getElementById('newAlbumName');
        this.createAlbumButton = document.getElementById('createAlbum');
        this.albumList = document.getElementById('albumList');
        this.confirmDeleteModal = document.getElementById('confirmDeleteModal');
        this.confirmDeleteMessage = document.getElementById('confirmDeleteMessage');
        this.confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        this.confirmCancelBtn = document.getElementById('confirmCancelBtn');
        this.headerTitle = document.getElementById('headerTitle');

        // モーダルを初期状態で非表示にする
        this.albumModal.hidden = true;
        this.albumModal.style.display = 'none';
        
        this.setupEventListeners();
        this.setupConfirmDeleteModalListeners();
    }

    async initialize() {
        await db.init();
        await auth.initialize();
        
        // IndexedDBにアクセス履歴があったらそれを開く
        let last_id = await db.getLastAccessedFolderId();
        if (last_id) {
            this.currentFolderId = last_id;
        } else {
            this.currentFolderId = await auth.getMusicFolderId();
        }
        if (this.currentFolderId) {
            this.loadFolder(this.currentFolderId);
        }

        await db.cleanupOldMusic();
    }

    setupEventListeners() {
        this.backButton.addEventListener('click', () => this.navigateBack());
        this.albumButton.addEventListener('click', () => this.showAlbumModal());
        this.createAlbumButton.addEventListener('click', () => this.createAlbum());
        this.headerTitle.addEventListener('click', () => this.moveToMusicFolder());
        
        // 閉じるボタンのイベントリスナーを修正
        const closeButton = this.albumModal.querySelector('.close-button');
        closeButton.addEventListener('click', () => this.hideAlbumModal());
    }

    setupConfirmDeleteModalListeners() {
        this.confirmCancelBtn.addEventListener('click', () => {
            this.hideConfirmDeleteModal();
        });
    }

    showLoading() {
        this.fileList.innerHTML = `
            <div class="loading">
                <svg class="spinner" viewBox="0 0 50 50">
                    <circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle>
                </svg>
                <p>読み込み中...</p>
            </div>
        `;
    }

    async loadFolder(folderId, folderName = '') {
        this.currentAlbum = null;
        
        if (this.currentFolderId) {
            this.pathStack.push({
                id: this.currentFolderId,
                name: this.currentPath.textContent
            });
        }

        this.currentFolderId = folderId;
        //this.backButton.hidden = this.pathStack.length === 0;
        this.currentPath.textContent = folderName;

        // フォルダアクセス履歴を更新
        await db.updateFolderAccess(folderId, folderName);

        this.showLoading();
        const files = await auth.listFiles(folderId);
        this.renderFileList(files);
    }

    async loadAlbum(album) {
        this.currentAlbum = album;
        this.currentPath.textContent = album.name;
        
        if (this.currentFolderId) {
            this.pathStack.push({
                id: this.currentFolderId,
                name: this.currentPath.textContent,
                isAlbum: false
            });
        }
        
        const songs = await db.getAlbumSongs(album.id);
        this.renderAlbumSongs(songs);
        this.hideAlbumModal();
    }

    renderAlbumSongs(songs) {
        this.fileList.innerHTML = '';

        songs.forEach(song => {
            const item = document.createElement('div');
            item.className = 'file-item';
            
            // スワイプ用の変数を追加
            let startX = 0;
            let currentX = 0;
            let isDragging = false;

            // タッチイベントリスナーを追加
            item.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                currentX = startX;
                isDragging = true;
                item.style.transition = 'none';
            });

            item.addEventListener('touchmove', (e) => {
                if (!isDragging) return;
                currentX = e.touches[0].clientX;
                const diff = currentX - startX;
                // 右から左へのスワイプのみ許可（diffが負の値）
                if (diff < 0) {
                    item.style.transform = `translateX(${diff}px)`;
                }
            });

            item.addEventListener('touchend', async (e) => {
                isDragging = false;
                item.style.transition = 'transform 0.3s ease';
                const diff = currentX - startX;
                
                // スワイプが-100px以上なら削除アクション
                if (diff < -100) {
                    const fileName = song.file_path.split('/').pop();
                    await db.removeFromAlbum(this.currentAlbum.id, song.file_path);
                    await this.loadAlbum(this.currentAlbum);
                    this.showMessage(`${fileName}を削除しました`);
                } else {
                    // スワイプが不十分な場合は元の位置に戻す
                    item.style.transform = 'translateX(0)';
                }
            });

            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('width', '24');
            icon.setAttribute('height', '24');
            
            icon.innerHTML = '<path fill="currentColor" d="M21,3V15.5A3.5,3.5 0 0,1 17.5,19A3.5,3.5 0 0,1 14,15.5A3.5,3.5 0 0,1 17.5,12C18.04,12 18.55,12.12 19,12.34V6.47L9,8.6V17.5A3.5,3.5 0 0,1 5.5,21A3.5,3.5 0 0,1 2,17.5A3.5,3.5 0 0,1 5.5,14C6.04,14 6.55,14.12 7,14.34V6L21,3Z" />';
            
            const fileName = song.file_path.split('/').pop();
            item.appendChild(icon);
            item.appendChild(document.createTextNode(fileName));
            
            item.addEventListener('click', () => {
                const file = {
                    id: song.file_id,
                    name: fileName
                };
                this.playFile(file);
            });
            
            item.addEventListener('contextmenu', e => {
                e.preventDefault();
                this.showConfirmDeleteModal(`アルバムから曲を削除しますか\n${fileName}`, async () => {
                    await db.removeFromAlbum(this.currentAlbum.id, song.file_path);
                    await this.loadAlbum(this.currentAlbum);
                    this.showMessage(`${fileName}を削除しました`);
                });
            });
            
            this.fileList.appendChild(item);
        });
    }

    navigateBack() {
        if (this.pathStack.length > 1) {
            const previousItem = this.pathStack.pop();
            this.currentFolderId = previousItem.id;
            this.currentPath.textContent = previousItem.name;
            
            if (previousItem.isAlbum) {
                this.loadAlbum(previousItem.album);
            } else {
                this.showLoading();
                auth.listFiles(this.currentFolderId).then(files => this.renderFileList(files));
            }
        } else {
            auth.getParentFolder(this.currentFolderId).then(folder => {
                if (folder) {
                    this.currentFolderId = folder.id;
                    this.currentPath.textContent = folder.name;
                    //this.backButton.hidden = this.pathStack.length === 0;
                        
                    this.showLoading();
                    auth.listFiles(this.currentFolderId).then(files => this.renderFileList(files));
                }
            });
        }
    }

    async renderFileList(files) {
        this.fileList.innerHTML = '';
        
        // フォルダとファイルを分離
        const folders = files.filter(f => f.folder);
        const nonFolders = files.filter(f => !f.folder);

        // フォルダアクセス履歴を取得
        const folderHistory = await db.getFolderHistory();
        const folderAccessMap = new Map(folderHistory.map(f => [f.id, f.last_accessed_at]));

        // フォルダを最終アクセス日時でソート
        folders.sort((a, b) => {
            const aTime = folderAccessMap.get(a.id) || 0;
            const bTime = folderAccessMap.get(b.id) || 0;
            return bTime - aTime;
        });

        // ファイルは作成日でソート
        nonFolders.sort((a, b) => {
            if (new Date(a.fileSystemInfo.createdDateTime) < new Date(b.fileSystemInfo.createdDateTime))
                return 1;
            else return -1;
        });

        // フォルダを先に表示し、その後にファイルを表示
        const sortedFiles = [...folders, ...nonFolders];

        sortedFiles.forEach(file => {
            const item = document.createElement('div');
            item.className = 'file-item';
            
            // 音楽ファイルの場合のみスワイプ機能を追加
            const ext = file.name.split('.').pop().toLowerCase();
            if (!file.folder && ['mp3', 'aac', 'm4a'].includes(ext)) {
                let startX = 0;
                let currentX = 0;
                let isDragging = false;

                item.addEventListener('touchstart', (e) => {
                    startX = e.touches[0].clientX;
                    currentX = startX;
                    isDragging = true;
                    item.style.transition = 'none';
                });

                item.addEventListener('touchmove', (e) => {
                    if (!isDragging) return;
                    currentX = e.touches[0].clientX;
                    const diff = currentX - startX;
                    if (diff < 0) {
                        item.style.transform = `translateX(${diff}px)`;
                    }
                });

                item.addEventListener('touchend', async (e) => {
                    isDragging = false;
                    item.style.transition = 'transform 0.3s ease';
                    const diff = currentX - startX;
                    
                    if (diff < -100) {
                        this.selectedFile = file;
                        this.addToAlbumMode = true;
                        this.showAlbumModal();
                    }
                    item.style.transform = 'translateX(0)';
                });
            }
            
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('width', '24');
            icon.setAttribute('height', '24');
            
            const isCurrentlyPlaying = file.id === player.getCurrentFileId();
            
            if (file.folder) {
                icon.innerHTML = '<path fill="currentColor" d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z" />';
                item.addEventListener('click', () => this.loadFolder(file.id, file.name));
            } else {
                if (['mp3', 'aac', 'm4a'].includes(ext)) {
                    if (isCurrentlyPlaying) {
                        icon.innerHTML = '<path fill="currentColor" d="M10,16.5V7.5L16,12M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z" />';
                    } else {
                        icon.innerHTML = '<path fill="currentColor" d="M21,3V15.5A3.5,3.5 0 0,1 17.5,19A3.5,3.5 0 0,1 14,15.5A3.5,3.5 0 0,1 17.5,12C18.04,12 18.55,12.12 19,12.34V6.47L9,8.6V17.5A3.5,3.5 0 0,1 5.5,21A3.5,3.5 0 0,1 2,17.5A3.5,3.5 0 0,1 5.5,14C6.04,14 6.55,14.12 7,14.34V6L21,3Z" />';
                    }
                    item.addEventListener('click', () => this.playFile(file));
                    item.addEventListener('contextmenu', e => {
                        e.preventDefault();
                        this.selectedFile = file;
                        this.addToAlbumMode = true;
                        this.showAlbumModal();
                    });
                } else {
                    icon.innerHTML = '<path fill="currentColor" d="M13,9H18.5L13,3.5V9M6,2H14L20,8V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V4C4,2.89 4.89,2 6,2M15,18V16H6V18H15M18,14V12H6V14H18Z" />';
                }
            }
            
            item.appendChild(icon);
            item.appendChild(document.createTextNode(file.name));
            this.fileList.appendChild(item);
        });
    }

    async playFile(file) {
        if (this.currentAlbum) {
            const songs = await db.getAlbumSongs(this.currentAlbum.id);
            await db.incrementAlbumUsage(this.currentAlbum.id);
            player.play(file, songs.map(song => ({
                id: song.file_id,
                name: song.file_path.split('/').pop()
            })));
        } else {
            const files = await auth.listFiles(this.currentFolderId);
            const musicFiles = files.filter(f => 
                !f.folder && ['mp3', 'aac', 'm4a'].includes(f.name.split('.').pop().toLowerCase())
            ).sort((a, b) => {
                if (new Date(a.fileSystemInfo.createdDateTime) < new Date(b.fileSystemInfo.createdDateTime))
                    return 1;
                else return -1;
            });
            player.play(file, musicFiles);
        }
    }

    showAlbumModal() {
        this.albumModal.hidden = false;
        this.albumModal.style.display = 'flex';
        this.refreshAlbumList();
    }

    hideAlbumModal() {
        this.albumModal.hidden = true;
        this.albumModal.style.display = 'none';
        this.addToAlbumMode = false;
        this.selectedFile = null;
    }

    showMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        messageElement.textContent = message;
        document.body.appendChild(messageElement);
        
        setTimeout(() => {
            messageElement.classList.add('fade-out');
            setTimeout(() => {
                document.body.removeChild(messageElement);
            }, 300);
        }, 2000);
    }

    async refreshAlbumList() {
        const albums = await db.getAllAlbums();
        this.albumList.innerHTML = '';
        
        albums.forEach(album => {
            const item = document.createElement('div');
            item.className = 'album-item';
            item.textContent = `${album.name} (${album.used_count}回再生)`;
            
            item.addEventListener('click', async () => {
                if (this.addToAlbumMode && this.selectedFile) {
                    await db.addSongToAlbum(album.id, this.selectedFile.name, this.selectedFile.id);
                    this.hideAlbumModal();
                    this.showMessage(`${album.name}に追加しました`);
                } else {
                    this.loadAlbum(album);
                }
            });
            
            item.addEventListener('contextmenu', async (e) => {
                e.preventDefault();
                this.showConfirmDeleteModal(`このアルバムを削除しますか\n${album.name}`, async () => {
                    try {
                        await db.deleteAlbum(album.id);
                        await this.refreshAlbumList();
                        this.showMessage(`アルバム "${album.name}" を削除しました`);
                        this.moveToMusicFolder()
                    } catch (error) {
                        console.error('Error deleting album:', error);
                        this.showMessage('アルバムの削除中にエラーが発生しました', 'error');
                    }
                });
            });
            
            this.albumList.appendChild(item);
        });
    }

    async createAlbum() {
        const name = this.newAlbumName.value.trim();
        if (name) {
            await db.createAlbum(name);
            this.newAlbumName.value = '';
            await this.refreshAlbumList();
        }
    }

    showConfirmDeleteModal(message, onConfirm) {
        this.confirmDeleteMessage.textContent = message;
        this.confirmDeleteModal.hidden = false;
        this.confirmDeleteModal.style.display = 'flex';
        
        // 既存のイベントリスナーを削除
        const oldConfirmBtn = this.confirmDeleteBtn;
        const newConfirmBtn = oldConfirmBtn.cloneNode(true);
        oldConfirmBtn.parentNode.replaceChild(newConfirmBtn, oldConfirmBtn);
        this.confirmDeleteBtn = newConfirmBtn;
        
        // 新しいイベントリスナーを追加
        this.confirmDeleteBtn.addEventListener('click', async () => {
            try {
                await onConfirm();
                this.hideConfirmDeleteModal();
                // 曲一覧を再読み込み
                this.loadAlbum(this.currentAlbum);
            } catch (error) {
                console.error('Error during delete operation:', error);
            }
        });
    }

    hideConfirmDeleteModal() {
        this.confirmDeleteModal.hidden = true;
        this.confirmDeleteModal.style.display = 'none';
    }

    async moveToMusicFolder() {
        this.currentFolderId = await auth.getMusicFolderId();
        this.loadFolder(this.currentFolderId);
    }
}

const app = new App();
app.initialize().catch(console.error);