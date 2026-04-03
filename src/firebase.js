import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// ============================================================
// ★ Firebase の設定を貼り付けてください ★
// ============================================================
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// ============================================================
// ★ GAS Web App の URL を貼り付けてください ★
// GAS でデプロイした時に表示される URL です
// 例: https://script.google.com/macros/s/XXXXX.../exec
// ============================================================
export const GAS_API_URL = "YOUR_GAS_WEB_APP_URL";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
