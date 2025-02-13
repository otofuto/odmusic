class MusicDB {
    constructor() {
        this.dbName = 'ODMusicDB';
        this.version = 2;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 音楽ファイルストア
                if (!db.objectStoreNames.contains('music')) {
                    const musicStore = db.createObjectStore('music', { keyPath: 'id' });
                    musicStore.createIndex('savedAt', 'savedAt', { unique: false });
                }

                // アルバムストア
                if (!db.objectStoreNames.contains('albums')) {
                    const albumsStore = db.createObjectStore('albums', { keyPath: 'id', autoIncrement: true });
                    albumsStore.createIndex('name', 'name', { unique: true });
                    albumsStore.createIndex('used_count', 'used_count', { unique: false });
                }

                // アルバムの曲リストストア
                if (!db.objectStoreNames.contains('album_songs')) {
                    const albumSongsStore = db.createObjectStore('album_songs', { keyPath: ['album_id', 'file_path'] });
                    albumSongsStore.createIndex('album_id', 'album_id', { unique: false });
                    albumSongsStore.createIndex('added_date', 'added_date', { unique: false });
                    albumSongsStore.createIndex('file_id', 'file_id', { unique: false });
                }

                // フォルダアクセス履歴ストア
                if (!db.objectStoreNames.contains('folder_history')) {
                    const folderHistoryStore = db.createObjectStore('folder_history', { keyPath: 'id' });
                    folderHistoryStore.createIndex('last_accessed_at', 'last_accessed_at', { unique: false });
                }
            };
        });
    }

    async saveMusic(id, blob) {
        const tx = this.db.transaction(['music'], 'readwrite');
        const store = tx.objectStore('music');
        await store.put({
            id,
            blob,
            savedAt: new Date().getTime()
        });
    }

    async getMusic(id) {
        const tx = this.db.transaction(['music'], 'readonly');
        const store = tx.objectStore('music');
        return new Promise((resolve, reject) => {
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async cleanupOldMusic() {
        const tx = this.db.transaction(['music'], 'readwrite');
        const store = tx.objectStore('music');
        const index = store.index('savedAt');
        const sevenDaysAgo = new Date().getTime() - (7 * 24 * 60 * 60 * 1000);

        const request = index.openCursor(IDBKeyRange.upperBound(sevenDaysAgo));
        
        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    store.delete(cursor.primaryKey);
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async updateFolderAccess(id, name) {
        const tx = this.db.transaction(['folder_history'], 'readwrite');
        const store = tx.objectStore('folder_history');
        await store.put({
            id,
            name,
            last_accessed_at: new Date().getTime()
        });
    }

    async getFolderHistory() {
        const tx = this.db.transaction(['folder_history'], 'readonly');
        const store = tx.objectStore('folder_history');
        const index = store.index('last_accessed_at');
        
        return new Promise((resolve, reject) => {
            const request = index.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getLastAccessedFolderId() {
        const tx = this.db.transaction(['folder_history'], 'readonly');
        const store = tx.objectStore('folder_history');
        const index = store.index('last_accessed_at');

        const request = index.openCursor(null, 'prev');

        return new Promise((resolve, reject) => {
            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                    resolve(cursor.value.id);
                } else {
                    resolve(null);
                }
            };
            request.onerror = event => {
                reject(event);
            };
        });
    }

    async createAlbum(name) {
        const tx = this.db.transaction(['albums'], 'readwrite');
        const store = tx.objectStore('albums');
        return store.add({
            name,
            used_count: 0
        });
    }

    async getAllAlbums() {
        const tx = this.db.transaction(['albums'], 'readonly');
        const store = tx.objectStore('albums');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async addSongToAlbum(albumId, filePath, fileId) {
        const tx = this.db.transaction(['album_songs'], 'readwrite');
        const store = tx.objectStore('album_songs');
        return store.add({
            album_id: albumId,
            file_path: filePath,
            file_id: fileId,
            added_date: new Date().getTime()
        });
    }

    async getAlbumSongs(albumId) {
        const tx = this.db.transaction(['album_songs'], 'readonly');
        const store = tx.objectStore('album_songs');
        const index = store.index('album_id');
        return new Promise((resolve, reject) => {
            const request = index.getAll(albumId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async incrementAlbumUsage(albumId) {
        const tx = this.db.transaction(['albums'], 'readwrite');
        const store = tx.objectStore('albums');
        const request = store.get(albumId);
        request.onsuccess = () => {
            const album = request.result;
            album.used_count++;
            store.put(album);
        };
    }

    async removeFromAlbum(albumId, filePath) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['album_songs'], 'readwrite');
            const store = tx.objectStore('album_songs');
            
            const request = store.delete([albumId, filePath]);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async deleteAlbum(albumId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['albums', 'album_songs'], 'readwrite');
            const albumsStore = tx.objectStore('albums');
            const albumSongsStore = tx.objectStore('album_songs');
            
            try {
                // まずalbum_songsから該当アルバムの曲をすべて削除
                const index = albumSongsStore.index('album_id');
                const cursorRequest = index.openCursor(IDBKeyRange.only(albumId));
                
                cursorRequest.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        albumSongsStore.delete(cursor.primaryKey);
                        cursor.continue();
                    } else {
                        // 次にアルバム自体を削除
                        const deleteRequest = albumsStore.delete(albumId);
                        deleteRequest.onsuccess = () => resolve();
                        deleteRequest.onerror = () => reject(deleteRequest.error);
                    }
                };
                cursorRequest.onerror = () => reject(cursorRequest.error);
                
            } catch (error) {
                reject(error);
            }
        });
    }
}

const db = new MusicDB();