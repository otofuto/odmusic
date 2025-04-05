const msalConfig = {
    auth: {
        clientId: "669901fb-dced-4093-9399-81294ef94997",
        authority: "https://login.microsoftonline.com/common",
        redirectUri: window.location.origin
    },
    cache: {
        cacheLocation: "localStorage",
        storeAuthStateInCookie: true
    }
};

// 開発環境でのみMSALをインスタンス化
const msalInstance = (window.location.hostname === 'localhost' || window.location.hostname === 'odmusic.otft.info')
    ? new msal.PublicClientApplication(msalConfig)
    : null;

class OneDriveAuth {
    constructor() {
        this.currentPath = '/';
        this.pathStack = [];
        this.maxRetries = 3;
        this.currentAccount = null;
    }

    async initialize() {
        if (msalInstance) {
            const accounts = msalInstance.getAllAccounts();
            if (accounts.length > 0) {
                this.currentAccount = accounts[0];
                await this.login();
            }
        }
    }

    async validateAndRefreshToken() {
        return new Promise(async (resolve, reject) => {
            await msalInstance.acquireTokenSilent({
                scopes: ["Files.Read"],
                account: this.currentAccount
            }).then(() => {
                resolve(true);
            }).catch(error => {
                if (error instanceof msal.InteractionRequiredAuthError) {
                    console.warn('トークン更新エラー: 再ログインが必要です', error);
                    reject(false);
                } else {
                    console.error('トークン更新エラー: ', error);
                    reject(false);
                }
            });
        });
    }

    async login(important = false) {
        try {
            // 1️⃣ まずリダイレクト後のレスポンスを処理
            const response = await msalInstance.handleRedirectPromise();
            if (response) {
                console.log("リダイレクト完了:", response);
                sessionStorage.removeItem("msalRedirectInProgress"); // フラグリセット
                this.currentAccount = response.account;
                return this.currentAccount;
            }
        } catch (error) {
            console.error("リダイレクト処理エラー:", error);
            sessionStorage.removeItem("msalRedirectInProgress"); // エラー時もリセット
        }
    
        // 2️⃣ すでにリダイレクト処理中なら処理を止める
        if (sessionStorage.getItem('msalRedirectInProgress') === "true") {
            console.log("すでにリダイレクト処理中...");
            let ars = ~~sessionStorage.getItem('alreadyRedirectStarted');
            ars++;
            if (ars >= 2) {
                ars = 0;
                sessionStorage.removeItem("msalRedirectInProgress");
            }
            sessionStorage.setItem('alreadyRedirectStarted', ars);
            return;
        }
    
        // 3️⃣ 既存のログイン状態をチェック
        if (!important) {
            const accounts = msalInstance.getAllAccounts();
            if (accounts.length > 0) {
                console.log("既存アカウント:", accounts[0]);
        
                const expirationTime = (accounts[0].idTokenClaims?.exp || 0) * 1000;
                if (expirationTime > Date.now()) {
                    console.log('トークン有効期限:', new Date(expirationTime));
                    this.currentAccount = accounts[0];
                    return this.currentAccount;
                }
            }
        }
    
        // 4️⃣ ポップアップでログイン試行
        try {
            console.log("ポップアップログインを試行...");
            const popupResponse = await msalInstance.loginPopup({ scopes: ["Files.Read"] });
            console.log("ポップアップログイン成功:", popupResponse);
            this.currentAccount = popupResponse.account;
            return;
        } catch (popupError) {
            console.error("ポップアップログイン失敗:", popupError);
            const knownErrors = [
                "popup_blocked_by_browser",
                "interaction_required",
                "login_required"
            ];
            if (knownErrors.includes(popupError.errorCode)) {
                console.log("ポップアップがブロックまたは無効。リダイレクトへ切り替えます...");
            } else {
                console.log("予期しないエラー。リダイレクトログインを試みます...");
            }
        }
    
        // 5️⃣ リダイレクトログイン
        try {
            app.showNotification('OneDriveへのログインが必要です。ログイン画面に移動します。', 3000);
            sessionStorage.setItem('msalRedirectInProgress', "true");
            console.log("ログインリダイレクト開始");
            msalInstance.loginRedirect({ scopes: ["Files.Read"] }); // await 不要
        } catch {
            sessionStorage.removeItem("msalRedirectInProgress");
            alert('ログイン処理に失敗しました。時間をおいてお試しください。');
        }
    }
    
    

    async getAccessToken() {
        if (!this.currentAccount) {
            await this.login();
        }

        if (!this.currentAccount) {
            alert('ログインに失敗しました');
            throw new Error("ログインできませんでした。");
        }

        try {
            const tokenResponse = await msalInstance.acquireTokenSilent({
                scopes: ["Files.Read"],
                account: this.currentAccount
            });
            return tokenResponse.accessToken;
        } catch (error) {
            if (error instanceof msal.InteractionRequiredAuthError) {
                console.log("トークンの再取得が必要です", error);
                await this.login(true);
                return this.getAccessToken();
            }
            console.error("トークン取得エラー:", error);
            throw error;
        }
    }

    async getMusicFolderId() {
        const accessToken = await this.getAccessToken();
        const url = "https://graph.microsoft.com/v1.0/me/drive/root/children";
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await response.json();
        
        const musicFolder = data.value.find(item => item.name === "音楽" && item.folder);
        return musicFolder ? musicFolder.id : null;
    }

    async listFiles(folderId) {
        const accessToken = await this.getAccessToken();
        let allFiles = [];
        let nextLink = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?$top=999`;

        while (nextLink) {
            const response = await fetch(nextLink, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const data = await response.json();

            if (data.value) {
                allFiles = allFiles.concat(data.value);
            }

            // @odata.nextLink が存在する場合、次のページがある
            nextLink = data['@odata.nextLink'] || null;
        }
        
        return allFiles.filter(item => !item.name.startsWith('.'));
    }

    async getParentFolder(folderId) {
        const accessToken = await this.getAccessToken();
    
        const url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}?$select=parentReference`;
        
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accessToken}`
            }
        });
    
        if (!response.ok) {
            console.error("親フォルダの取得に失敗:", response.status, response.statusText);
            return null;
        }
    
        const data = await response.json();
        return data.parentReference ?? null;
    }

    async downloadFile(file) {
        const accessToken = await this.getAccessToken();
        const url = `https://graph.microsoft.com/v1.0/me/drive/items/${file.id}/content`;
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        let blob = await response.blob();
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext == 'aac') {
            return new Blob([blob], { type: "audio/aac" });
        }
        return blob;
    }
}

// Handle redirect response
if (window.location.hostname === 'localhost' || window.location.hostname === 'odmusic.otft.info') {
    msalInstance.handleRedirectPromise().catch(error => {
        console.error("Redirect handling error:", error);
    });
}

const auth = new OneDriveAuth();