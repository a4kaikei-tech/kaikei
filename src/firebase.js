import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, memoryLocalCache } from "firebase/firestore";

// ★ Firebase の設定を貼り付けてください ★
const firebaseConfig = {
  apiKey: "AIzaSyC0hvYRgk1AUcLIrrhMU7XbuNhplClymfw",
  authDomain: "a4-kaikei.firebaseapp.com",
  projectId: "a4-kaikei",
  storageBucket: "a4-kaikei.firebasestorage.app",
  messagingSenderId: "294563699065",
  appId: "1:294563699065:web:b268ceb02cdec94c55b7a8",
  measurementId: "G-Y7LNS4X9YH"
};


// ★ GAS Web App の URL を貼り付けてください ★
export const GAS_API_URL = "https://script.google.com/macros/s/AKfycby9iebFS-JxOdZ5mw9zRslmPNfsCqm8fk8Qb8LSSY2QUO5ylFDktrDsOX24WDKybA7a/exec";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Firestoreのオフラインキャッシュを無効化（端末にデータを残さない）
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
});
