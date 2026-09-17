# Privacy Policy for YouTube Music Rich Presence

**Last Updated:** September 17, 2026

Thank you for using YouTube Music Rich Presence ("the Extension"). This Privacy Policy explains what information the Extension accesses, how that information is used, and how your privacy is protected when using the Extension, its companion application, and the optional Listen Together feature.

---

### 1. Information We Access and Collect

The Extension only accesses information strictly necessary to provide its features:

* **Music Metadata:** When you are actively using YouTube Music (`music.youtube.com`), the Extension reads real-time playback metadata including track title, artist name, album name, playback progress, duration, playback state (playing/paused), and album artwork.
* **Listen Together Session Data (Optional):** When you actively create or join a "Listen Together" session, the Extension generates or accepts a temporary session room code (e.g., `YTM-XXXXXX`), a user-chosen display name, and transmits the current video ID, playback timestamp, and upcoming queue items to keep connected listeners in sync.
* **Extension Settings:** User preferences (such as auto-stop idle hosting timeouts, user display name, and feature toggles) are stored locally on your device using your browser's local storage API (`chrome.storage.local`).

The Extension **does not** collect, store, or transmit personal information such as your real name, email address, passwords, payment details, Discord account credentials, browsing history outside of YouTube Music, or any audio/video stream content.

---

### 2. How Information Is Used

Information accessed by the Extension is used exclusively for the following purposes:

* **To Display Discord Rich Presence:** Music metadata is sent locally to the companion application running on your computer via native messaging (`chrome.runtime.sendNativeMessage`), which then updates your Discord status via the local Discord IPC socket.
* **To Synchronize Playback ("Listen Together"):** Session room codes, playback timestamps, and queue metadata are broadcasted to session participants so that track changes, seeks, and play/pause states mirror each other across participants in real time.
* **To Route Invite Links:** The Extension interacts with the static project gateway (`https://fishyspop.github.io/Youtube-music-rich-presence/`) solely to detect session invite links and open the corresponding session on YouTube Music.
* **To Persist Local Preferences:** Settings are saved locally so the Extension retains your choices between browsing sessions.

---

### 3. Third Parties and Network Communications

* **Local Companion Application:** For Discord Rich Presence, metadata is sent exclusively across your local computer to the companion app. It is never uploaded to an external server by the Extension for this purpose.
* **Public Relay Broker (HiveMQ):** For the Listen Together feature, synchronization packets are relayed across an encrypted TLS WebSocket connection (`wss://broker.hivemq.com:8884/mqtt`).
  * **Privacy Architecture:** Listen Together utilizes a pure broker relay design. Participants communicate exclusively through the broker rather than direct peer-to-peer WebRTC connections. This ensures that your IP address is never revealed to other participants in the room.
  * **Transient Data Only:** Packets relayed through the broker are ephemeral in-memory pub/sub messages. They are never recorded, logged, or permanently stored by the Extension.
* **No Marketing or Advertising:** We do not sell, rent, trade, or share your data with advertisers, data brokers, or any third parties for commercial or tracking purposes.

---

### 4. Data Retention

* **Playback & Session Data:** Processed strictly in memory in real time. When you pause playback, close the tab, or leave a Listen Together session, all active session data is immediately discarded.
* **Local Settings:** Retained in your browser's local storage until you uninstall the Extension or manually clear your browser data.

---

### 5. Data Security

The Extension communicates with external signaling services exclusively over encrypted transport layer security (TLS/WSS). Local communication with the companion application is restricted to your machine via Chrome's native messaging host protocol.

---

### 6. Children's Privacy

The Extension is not intended for use by children under the age of 13 (or the applicable age of consent in your jurisdiction). We do not knowingly collect personal information from children.

---

### 7. Changes to This Privacy Policy

We may update this Privacy Policy to reflect future feature updates or technical changes. Any revisions will be reflected on this page with an updated revision date.

---

### 8. Contact Us

If you have questions or concerns regarding this Privacy Policy, you can reach us at:  
`music@fishyserver.uk`