# Kaikei 会計ソフト — セットアップガイド

## 使用サービス（すべて無料・クレジットカード不要）

| サービス | 用途 | 無料枠 |
|---------|------|--------|
| Firebase Auth | ユーザー認証 | 無制限 |
| Firestore | データベース | 1GB / 1日5万読取 |
| GAS + Google Drive | 領収書ファイル保存 | 15GB（Googleアカウントの容量） |
| Vercel | Webホスティング | 無制限（個人利用） |

---

## Step 1: Firebase の設定

1. https://console.firebase.google.com/ でプロジェクト作成
2. Authentication → メール/パスワードを有効化
3. Firestore Database → テストモードで作成（asia-northeast1）
4. プロジェクト設定 → Webアプリ登録 → firebaseConfig をコピー
5. `src/firebase.js` の Firebase 設定部分を置き換え

---

## Step 2: GAS（Google Apps Script）の設定

### 2-1. Google Drive にフォルダを作成

1. https://drive.google.com を開く
2. 「新規」→「新しいフォルダ」→ 名前「Kaikei領収書」で作成
3. 作成したフォルダを開く
4. URLの末尾のIDをコピー
   例: `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp`
   → `1AbCdEfGhIjKlMnOp` がフォルダID

### 2-2. GAS プロジェクトを作成

1. https://script.google.com にアクセス
2. 「新しいプロジェクト」をクリック
3. 既存のコードをすべて削除
4. `gas/Code.gs` の内容をすべてコピーして貼り付け
5. 先頭付近の `FOLDER_ID` を、2-1でコピーしたフォルダIDに変更:
   ```js
   var FOLDER_ID = "1AbCdEfGhIjKlMnOp";  // ← あなたのフォルダID
   ```
6. プロジェクト名を「Kaikei API」などに変更（左上のタイトルをクリック）
7. 「Ctrl + S」で保存

### 2-3. Web アプリとしてデプロイ

1. 右上の「デプロイ」→「新しいデプロイ」をクリック
2. 左側の歯車アイコンをクリック →「ウェブアプリ」を選択
3. 以下を設定:
   - 説明: 「Kaikei API」
   - 実行ユーザー: **自分のメールアドレス**
   - アクセスできるユーザー: **全員**
4. 「デプロイ」をクリック
5. 「アクセスを承認」→ Googleアカウントを選択
6. 「詳細」→「Kaikei API（安全ではないページ）に移動」をクリック
7. 「許可」をクリック
8. 表示される **ウェブアプリのURL** をコピー
   例: `https://script.google.com/macros/s/AKfycb.../exec`

### 2-4. アプリに URL を設定

`src/firebase.js` の GAS_API_URL を書き換え:
```js
export const GAS_API_URL = "https://script.google.com/macros/s/AKfycb.../exec";
```

---

## Step 3: Vercel でデプロイ

1. コードを GitHub にアップロード
2. https://vercel.com →「Continue with GitHub」でログイン
3. 「Add New」→「Project」→ リポジトリを Import
4. 「Deploy」をクリック → 完了！

---

## ファイル構成

```
membership-app/
├── gas/
│   └── Code.gs              ← GAS に貼り付けるコード
├── public/
│   └── index.html
├── src/
│   ├── index.js
│   ├── App.js                ← アプリ本体
│   └── firebase.js           ← ★ Firebase + GAS URL 設定
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
└── package.json
```

## 仕組み

```
ユーザー → React アプリ (Vercel)
              ├── 認証・データ → Firebase Auth + Firestore
              └── ファイル保存 → GAS Web App → Google Drive
```

- 仕訳、請求書、勘定科目 → Firestore に保存
- 領収書の画像・PDF → GAS 経由で Google Drive に保存
- ファイルのメタデータ（URL等） → Firestore に保存

## GAS を更新した場合

GAS のコードを変更したら、再デプロイが必要です:
1. GAS エディタで「デプロイ」→「デプロイを管理」
2. 鉛筆アイコンをクリック
3. バージョン: 「新しいバージョン」を選択
4. 「デプロイ」をクリック

※ URL は変わりません。
