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
        this.isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === 'odmusic.otft.info';
        this.currentAccount = null;
    }

    async initialize() {
        if (!this.isLocalhost) {
            console.log('開発環境ではOneDriveのログインはスキップされます');
            return;
        }
        
        if (msalInstance) {
            const accounts = msalInstance.getAllAccounts();
            if (accounts.length > 0) {
                this.currentAccount = accounts[0];
                await this.validateAndRefreshToken();
            }
        }
    }

    async validateAndRefreshToken() {
        try {
            await msalInstance.acquireTokenSilent({
                scopes: ["Files.Read"],
                account: this.currentAccount
            });
            return true;
        } catch (error) {
            if (error instanceof msal.InteractionRequiredAuthError) {
                console.error(error);
                return false;
            }
            throw error;
        }
    }

    async login() {
        if (!this.isLocalhost) {
            console.log('開発環境ではOneDriveのログインはスキップされます');
            return null;
        }

        if (this.currentAccount) {
            const isValid = await this.validateAndRefreshToken();
            if (isValid) {
                return this.currentAccount;
            }
        }

        let retryCount = 0;
        while (retryCount < this.maxRetries) {
            try {
                const response = await msalInstance.handleRedirectPromise();
                if (response) {
                    console.log("リダイレクト完了:", response);
                    sessionStorage.removeItem("msalRedirectInProgress");
                }

                const accounts = msalInstance.getAllAccounts();
                if (accounts.length > 0) {
                    if (new Date(accounts[0].idTokenClaims.exp * 1000) > new Date()) {
                        this.currentAccount = accounts[0];
                        return this.currentAccount;
                    }
                }

                // すでにリダイレクトを開始している場合は、再実行しない
                if (sessionStorage.getItem('msalRedirectInProgress') === "true") {
                    console.log("すでにリダイレクト処理中...");
                    return;
                }

                // ログインが必要
                alert('OneDriveへのログインが必要です。ログイン画面に移動します。');
                sessionStorage.setItem('msalRedirectInProgress', "true"); // フラグをセット
                await msalInstance.loginRedirect({ scopes: ["Files.Read"] });
            } catch (error) {
                console.error("ログインエラー:", error);
                retryCount++;
                if (retryCount === this.maxRetries) {
                    alert('ログインに失敗しました。ページを再読み込みして再度お試しください。');
                    throw error;
                }
            }
        }
    }

    async getAccessToken() {
        if (!this.isLocalhost) {
            console.log('開発環境ではOneDriveのログインはスキップされます');
            return null;
        }

        if (!this.currentAccount) {
            await this.login();
        }

        if (!this.currentAccount) {
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
                console.log("トークンの再取得が必要です");
                await this.login();
                return this.getAccessToken();
            }
            console.error("トークン取得エラー:", error);
            throw error;
        }
    }

    async getMusicFolderId() {
        if (!this.isLocalhost) {
            console.log('開発環境ではOneDriveのログインはスキップされます');
            return null;
        }

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
        if (!this.isLocalhost) {
            console.log('開発環境ではOneDriveのログインはスキップされます');
            return [];
        }

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
        if (!this.isLocalhost) {
            console.log('開発環境ではOneDriveのログインはスキップされます');
            return null;
        }

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

    async downloadFile(fileId) {
        if (!this.isLocalhost) {
            console.log('開発環境ではOneDriveのログインはスキップされます');
            return new Blob();
        }

        const accessToken = await this.getAccessToken();
        const url = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`;
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        return await response.blob();
    }
}

// Handle redirect response
if (window.location.hostname === 'localhost' || window.location.hostname === 'odmusic.otft.info') {
    msalInstance.handleRedirectPromise().catch(error => {
        console.error("Redirect handling error:", error);
    });
}

const auth = new OneDriveAuth();