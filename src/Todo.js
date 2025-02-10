// Todo.js
import React, { useState, useEffect } from 'react';
import './App.css';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, onValue, remove, set as setRTDB } from 'firebase/database';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { collection, addDoc } from "firebase/firestore";


// Firebase konfiguracijaaa
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL
};

// Inicijalizacija Firebase aplikacije
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const messaging = getMessaging(app);
const firestore = getFirestore(app);

// Funkcija za traženje dozvole za notifikacije
function requestPermission() {
  console.log('Requesting notification permission...');
  Notification.requestPermission().then((permission) => {
    if (permission === 'granted') {
      console.log('Notification permission granted.');
      // Dohvati token (on će se kasnije snimiti u Firestore nakon prijave)
      getToken(messaging, { vapidKey: process.env.REACT_APP_FIREBASE_VAPID_KEY })
        .then((currentToken) => {
          if (currentToken) {
            console.log('Registration token:', currentToken);
          } else {
            console.log('No registration token available.');
          }
        })
        .catch((err) => {
          console.error('Error retrieving token', err);
        });
    } else {
      console.error('Unable to get notification permission.');
    }
  });
}

function App() {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  async function saveToken() {
    try {
      const messaging = getMessaging();
      const token = await getToken(messaging, { vapidKey: process.env.REACT_APP_FIREBASE_VAPID_KEY })  
      if (token) {
        console.log("FCM Token:", token);
        const user = auth.currentUser; // Trenutni korisnik
        if (user) {
          await setDoc(doc(firestore, "users", user.uid), {
            email: user.email,
            registrationToken: token,
          }, { merge: true });
          console.log("Token sačuvan u Firestore.");
        }
      } else {
        console.warn("Korisnik nije dozvolio notifikacije.");
      }
    } catch (error) {
      console.error("Greška pri dobijanju FCM tokena:", error);
    }
  }
saveToken();

  // Praćenje stanja prijave korisnika
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    requestPermission();
    return () => unsubscribe();
  }, []);

  // Učitavanje namirnica iz Realtime Database kada je korisnik prijavljen
  useEffect(() => {
    if (user) {
      const itemsRef = ref(database, 'groceryItems');
      onValue(itemsRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const loadedItems = Object.keys(data).map((key) => ({ id: key, ...data[key] }));
          setItems(loadedItems);
        } else {
          setItems([]);
        }
      });
    } else {
      setItems([]);
    }
  }, [user]);

  // Dodavanje nove namirnice
  const addItem = async () => {
    if (input.trim() !== '' && user) {
      try {
        const itemsRef = ref(database, 'groceryItems');
        const newItemRef = push(itemsRef);
        setRTDB(newItemRef, { name: input, completed: false });
  
        // Snimanje u Firestore
        await addDoc(collection(firestore, "messages"), {
          name: input,
          createdAt: new Date()
        });
  
        console.log("Dodato u Firestore!"); // Provera u konzoli
        setInput('');
      } catch (error) {
        console.error("Error adding document: ", error);
      }
    }
  };
  
  

  // Označavanje namirnice kao završene ili ne
  const toggleItem = (id) => {
    if (user) {
      const itemRef = ref(database, `groceryItems/${id}`);
      const item = items.find((item) => item.id === id);
      setRTDB(itemRef, { ...item, completed: !item.completed });
    }
  };

  // Brisanje namirnice
  const deleteItem = (id) => {
    if (user) {
      const itemRef = ref(database, `groceryItems/${id}`);
      remove(itemRef);
    }
  };

  // Prijava putem Google-a
  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Error signing in with Google:', error);
    }
  };

  // Odjava korisnika
  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  // Registracija Service Workera i snimanje FCM tokena u Firestore nakon prijave
  useEffect(() => {
    if (user && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/firebase-messaging-sw.js')
        .then((registration) => {
          console.log('Service Worker registration successful:', registration);
          getToken(messaging, { vapidKey: process.env.REACT_APP_FIREBASE_VAPID_KEY })
            .then((currentToken) => {
              if (currentToken) {
                // Snimanje tokena u Firestore pod dokumentom korisnika (collection "users")
                const userDocRef = doc(firestore, "users", user.uid);
                setDoc(userDocRef, {
                  registrationToken: currentToken,
                  email: user.email
                })
                .then(() => {
                  console.log("Token saved to Firestore.");
                })
                .catch((err) => {
                  console.error("Error saving token to Firestore", err);
                });
              }
            })
            .catch((err) => {
              console.error('Error retrieving token:', err);
            });
        })
        .catch((err) => {
          console.error('Service Worker registration failed:', err);
        });
    }
  }, [user]);

  // Slušanje poruka dok je aplikacija u foreground-u
  useEffect(() => {
    onMessage(messaging, (payload) => {
      console.log('Foreground message received:', payload);
      setUnreadNotifications(prev => prev + 1);
      if (Notification.permission === 'granted') {
        new Notification(payload.notification.title, {
          body: payload.notification.body,
          icon: '/favicon.ico',
        });
      }
    });
  }, []);

  // Resetovanje broja nepročitanih notifikacija pri otvaranju aplikacije
  const resetBadge = () => {
    setUnreadNotifications(0);
    if ('clearAppBadge' in navigator) {
      navigator.clearAppBadge();
    }
  };

  useEffect(() => {
    resetBadge();
  }, []);

  return (
    <div className="app-container">
      {!user ? (
        <div className="auth-container">
          <h2>Prijava</h2>
          <button onClick={loginWithGoogle}>Prijavi se putem Google-a</button>
        </div>
      ) : (
        <div>
          <div className="header-container">
            <button className="logout-button" onClick={logout}>Odjava</button>
          </div>
          <h1>Lista namirnica</h1>
          <div className="input-container">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Dodaj namirnicu..."
              onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
            />
            <button onClick={addItem}>Dodaj</button>
          </div>
          {/* <div className="notifications">
            <span>{unreadNotifications > 0 ? `Imate ${unreadNotifications} nove obavještenja` : 'Nema novih obavještenja'}</span>
          </div> */}
          <ul className="item-list">
            {items.map((item) => (
              <li key={item.id} className={`item ${item.completed ? 'completed' : ''}`}>
                <span onClick={() => toggleItem(item.id)}>{item.name}</span>
                <button onClick={() => deleteItem(item.id)}>Obriši</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default App;
