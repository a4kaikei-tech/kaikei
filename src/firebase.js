import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// ============================================================
// ★ Firebase の設定を貼り付けてください ★
// ============================================================
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC0hvYRgk1AUcLIrrhMU7XbuNhplClymfw",
  authDomain: "a4-kaikei.firebaseapp.com",
  projectId: "a4-kaikei",
  storageBucket: "a4-kaikei.firebasestorage.app",
  messagingSenderId: "294563699065",
  appId: "1:294563699065:web:b268ceb02cdec94c55b7a8",
  measurementId: "G-Y7LNS4X9YH"
};

// ============================================================
// ★ GAS Web App の URL を貼り付けてください ★
// GAS でデプロイした時に表示される URL です
// 例: https://script.google.com/macros/s/XXXXX.../exec
// ============================================================
export const GAS_API_URL = "https://script.google.com/macros/s/AKfycby9iebFS-JxOdZ5mw9zRslmPNfsCqm8fk8Qb8LSSY2QUO5ylFDktrDsOX24WDKybA7a/exec";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
