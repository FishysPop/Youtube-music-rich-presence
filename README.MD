# YouTube Music Rich Presence for Discord

Displays your YouTube Music activity as your Discord Rich Presence. This Chrome extension needs a native host app to communicate with Discord.

## ✨ Features

*   **🎤 Real-time Updates:** Shows the song, artist, and album art currently playing on YouTube Music.
*   **Discord Integration:** Updates your Discord status with your listening activity.
*   **Extension Popup Controls:**
    *   Shows Native Host & Discord connection status.
    *   Displays current song.
*   **Interactive Discord Presence:** Buttons in your Discord presence to:
    *   Link directly to the song on YouTube Music.
    *   Link to this project's GitHub page.

## ⚙️ How it Works

This system has two parts:

1.  **Chrome Extension (this project's `/extention` folder):**
    *   **Content Script:** Identifies track, artist, and album art on `music.youtube.com`.
    *   **Background Script:** Handles logic, talks to the content script, and the native host.
    *   **Popup UI:** Shows status and offers controls.

2.  **Native Host Application (companion program):**
    *   A separate program the extension uses to talk to Discord.
    *   Interacts with your Discord client to update Rich Presence.
    *   Download from this repository's releases.

## ✅ Prerequisites

*   A Chromium-based web browser (e.g., Google Chrome, Microsoft Edge, Brave).
*   The **YouTube Music Rich Presence Native Host** application.

## 🚀 Installation

You need to install two things: the Native Host and the Chrome Extension.

**1. Native Host Application**

   *   Go to the **Releases Page** of this GitHub repository.
   *   Download `YouTubeMusicRPCSetup.exe` from the latest release.
   *   Run `YouTubeMusicRPCSetup.exe` and follow the on-screen instructions to install the native host application. This will register it with your browser.
   *   **🤔 Why is a separate installer/application needed?**
       *   **Security:** Browsers restrict extensions from running local programs directly.
       *   **Native Messaging:** To communicate with Discord, the extension needs this helper application. The installer registers this "Native Messaging host" with your browser. This process involves creating a manifest file (JSON) that tells the browser where the `youtube_music_rpc.exe` (or similarly named executable installed by the setup) is located and allows this specific extension to connect to it. This is a standard and secure method.
   *   After installation, the native application (e.g., `youtube_music_rpc.exe`) should ideally run automatically. If not, you might need to start it manually. It needs to be running for the extension to work.

### 2. 🌐 Chrome Extension

   *   **Option A: Chrome Web Store (Recommended)**
      *   *(Link will be here once published.)*
   *   **Option B: Manual Installation (Sideloading)**
      1.  Download or clone this repository.
      2.  Extract the ZIP file if you downloaded it.
      3.  Go to `chrome://extensions` in your browser.
      4.  Enable **Developer mode** (usually a top-right toggle).
      5.  Click the **"Load unpacked"** button.
      6.  Select the `extention` subfolder from this repository.
      7.  The extension should now be listed and active.

## ▶️ Usage

1.  **Start the Native Host application.**
2.  **Ensure the extension is enabled** in `chrome://extensions`.
3.  **Play a song on YouTube Music.**
4.  **Your Discord status should update.**
5.  **Use the extension popup:**
    *   Click the extension's icon in your browser toolbar.
    *   View connection status and current song.
    *   Use "Reconnect" if there are issues.
    *   Use "Disconnect" to stop sharing your activity.
    *   Click "Options" for auto-reconnect, logs, or to open the main options page.

## 🛠️ Troubleshooting

*   **Popup shows "Native Host Issue" or "Could not connect":**
    *   Ensure the **Native Host Application** is installed correctly from Releases.
    *   Check if the native app (e.g., `youtube_music_rpc.exe`) is running (use Task Manager/Activity Monitor).
    *   Try re-running `YouTubeMusicRPCSetup.exe`.
    *   Click the "Reconnect" button in the extension popup.
    *   Restart your browser.

*   **Native Host is "Connected" but RPC Status is "Disconnected" or "Connecting...":**
    *   Ensure your Discord desktop client is running and you are logged in.
    *   The native host might have trouble with Discord. Check native host logs if you can.
    *   Restart Discord, then the native host, then click "Reconnect" in the popup.

*   **Song information is not updating in Discord:**
    *   Make sure the active tab is `music.youtube.com` and a song is playing.
    *   Try refreshing the YouTube Music page.
    *   Check the extension popup for any error messages or status changes.
    *   Check browser console (F12 -> Console) on YouTube Music for "[YTMusicRPC Content]" errors.
    *   Check extension's background console: `chrome://extensions` -> Details -> "Inspect views: service worker" (or "background page").
