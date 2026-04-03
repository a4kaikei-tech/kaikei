// ============================================================
// Kaikei 会計ソフト — Google Apps Script (GAS)
// Google Drive にファイルを保存する API サーバー
// ============================================================
//
// 【セットアップ手順】
// 1. https://script.google.com にアクセス
// 2. 「新しいプロジェクト」をクリック
// 3. このファイルの内容をすべてコピーして貼り付け
// 4. 下の FOLDER_ID を自分の Google Drive フォルダIDに変更
// 5. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
//    - 実行ユーザー: 「自分」
//    - アクセスできるユーザー: 「全員」
// 6. 「デプロイ」をクリック → 表示されるURLをコピー
// ============================================================

// ★ Google Drive のフォルダID を設定してください ★
// Google Drive でフォルダを開いた時のURL末尾の文字列です
// 例: https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp ← この「1AbCdEfGhIjKlMnOp」部分
var FOLDER_ID = "YOUR_FOLDER_ID";

// CORS対応: OPTIONSリクエストに応答
function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
}

// POSTリクエスト: ファイルアップロード
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action;

    if (action === "upload") {
      return uploadFile(data);
    } else if (action === "delete") {
      return deleteFile(data);
    } else if (action === "list") {
      return listFiles(data);
    }

    return jsonResponse({ success: false, error: "Unknown action" });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// GETリクエスト: 動作確認用
function doGet(e) {
  var action = e.parameter.action;

  if (action === "list") {
    return listFiles(e.parameter);
  }

  return jsonResponse({
    success: true,
    message: "Kaikei GAS API is running",
    folderId: FOLDER_ID,
  });
}

// ファイルアップロード
function uploadFile(data) {
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var fileName = data.fileName || "unnamed_file";
  var mimeType = data.mimeType || "application/octet-stream";
  var base64Data = data.fileData; // Base64エンコードされたファイルデータ

  // Base64デコード
  var decoded = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(decoded, mimeType, fileName);

  // Google Drive に保存
  var file = folder.createFile(blob);

  // 誰でも閲覧可能にする（URLでアクセスできるように）
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var fileId = file.getId();
  var fileUrl =
    "https://drive.google.com/uc?export=view&id=" + fileId;
  var thumbnailUrl =
    "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w400";

  return jsonResponse({
    success: true,
    fileId: fileId,
    fileName: fileName,
    fileUrl: fileUrl,
    thumbnailUrl: thumbnailUrl,
    mimeType: mimeType,
    size: decoded.length,
  });
}

// ファイル削除
function deleteFile(data) {
  try {
    var file = DriveApp.getFileById(data.fileId);
    file.setTrashed(true);
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: "File not found" });
  }
}

// ファイル一覧
function listFiles(data) {
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var files = folder.getFiles();
  var result = [];

  while (files.hasNext()) {
    var file = files.next();
    result.push({
      fileId: file.getId(),
      fileName: file.getName(),
      mimeType: file.getMimeType(),
      size: file.getSize(),
      createdAt: file.getDateCreated().toISOString(),
      fileUrl:
        "https://drive.google.com/uc?export=view&id=" + file.getId(),
    });
  }

  return jsonResponse({ success: true, files: result });
}

// JSON レスポンスヘルパー
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
