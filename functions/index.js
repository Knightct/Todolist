// functions/index.js
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();

exports.sendNotificationOnNewMessage = onDocumentCreated(
  {
    document: "messages/{messageId}",
    region: "europe-west1"  // eksplicitno postavljanje regije
  },
  async (event) => {
    const snap = event.data;
    if (!snap.exists) {
      console.log("Dokument ne postoji.");
      return;
    }

    const messageData = snap.data();
    console.log("New Firestore message:", messageData);

    // Dohvat svih FCM tokena iz kolekcije "users"
    const usersSnapshot = await admin.firestore().collection("users").get();
    const tokens = [];
    usersSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.registrationToken) {
        tokens.push(data.registrationToken);
      }
    });
    console.log("Tokens fetched:", tokens);

    // Ako postoje tokeni, sastavi payload i pošalji notifikaciju
    if (tokens.length > 0) {
      const payload = {
        webpush: {
          headers: { Urgency: 'high' },
          notification: {
            title: "Nova namirnica dodata!",
            body: `Dodato: ${messageData.name}`,
            icon: '/favicon.ico',
            badge: '/badge-icon.png'
          },
          fcmOptions: { link: process.env.REACT_APP_FCM_LINK }
        }
      };

      try {
        const messaging = admin.messaging();
        await messaging.sendEachForMulticast({
          tokens: tokens,
          ...payload

        });
        console.log(`Notification sent. Success: ${response.successCount}, Failure: ${response.failureCount}`);
      } catch (error) {
        console.error("Error sending notification:", error);
      }
    } else {
      console.log("No tokens available for sending notifications.");
    }
  }
);
