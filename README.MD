# YouTube Music Rich Presence for Discord

Show your currently playing YouTube Music song as your Discord Rich Presence. This Chrome extension uses a native host application to talk to Discord.

## Features

*   **🎤 Real-time Updates:** Shows the song, artist, and album art currently playing on YouTube Music.
*   **Real-time Updates:** Displays the current song, artist, and album art.
*   **Discord Integration:** Updates your Discord status with your listening activity.
*   **Extension Popup:**
    *   Shows Native Host & Discord connection status.
    *   Displays current song.
    *   **Reconnect Button:** For the native host.
    *   **Disconnect Button:** To stop sharing activity.
    *   **Options Button:**
        *   Toggle "Auto Reconnect".
        *   View a quick error log.
        *   Access extension options page.
*   **Native Host Helper:** Warns if the native host is missing and provides a download link.
*   **Interactive Discord Presence:** Buttons in your Discord presence to:
    *   Link directly to the song on YouTube Music.
    *   Link to this project's GitHub page.

## How it Works

Two main parts:

1.  **Chrome Extension (this project's `/extention` folder):**
    *   **Content Script:** Identifies track, artist, and album art on `music.youtube.com`.
    *   **Background Script:** Manages logic, communicates with the content script, and interfaces with the native host.
    *   **Popup UI:** Shows status and provides basic controls.

2.  **Native Host Application (companion program):**
    *   A separate program the extension communicates with.
    *   Interacts with your Discord client to update Rich Presence.
    *   Download from this repository's releases.

## Prerequisites

*   A Chromium-based web browser (e.g., Google Chrome, Microsoft Edge, Brave).
*   The **YouTube Music Rich Presence Native Host** application.

## Installation

Install two components: Native Host and Chrome Extension.

**1. Native Host Application**

   *   Go to the **Releases Page** of this GitHub repository.
   *   Download the `.zip` for your OS (e.g., `win-x64.zip` for Windows).
   *   Extract the archive to a permanent folder.
   *   Run `install.bat` (Windows) or `install.sh` (macOS/Linux) from the extracted folder. This registers the native host with your browser.
   *   **Why an installer script?**
       *   **Security:** Browsers restrict extensions from running local programs directly.
       *   **Native Messaging:** The script registers the native host with your browser using a standard "Native Messaging" protocol. This involves creating a manifest file (JSON) that tells the browser where to find the native host executable and allows this specific extension to connect.
       *   **Transparency:** You can inspect the script (e.g., `install.bat`) to see it creates this manifest.
   *   After running the script, ensure the native application (e.g., `youtube_music_rpc.exe` on Windows) is running. It might need to be started manually after each system boot.

### 2. Chrome Extension

   *   **Option A: Chrome Web Store (Recommended)**
      *   *(Link will be here once published.)*

   *   **Option B: Manual Installation (Sideloading)**
      1.  Download or clone this repository.
      2.  Extract the ZIP file if you downloaded it.
      3.  Go to `chrome://extensions` in your browser.
      4.  Enable **Developer mode** (top-right toggle).
      5.  Click the **"Load unpacked"** button.
      6.  In the file dialog, navigate to the folder where you downloaded/cloned the repository and select the `extention` subfolder (this is the folder containing `manifest.json`, `popup.html`, etc.).
      7.  The "YouTube Music Rich Presence" extension should now appear in your list of installed extensions and be active.

## ▶️ Usage

1.  **Start the Native Host application.**
2.  **Ensure the extension is enabled** in `chrome://extensions`.
3.  **Play a song on YouTube Music.**
4.  **Your Discord status should update.**
5.  **Use the extension popup:**
    *   Click the extension's icon in your browser toolbar.
    *   View connection status and current song.
    *   Use "Reconnect" for issues.
    *   Use "Disconnect" to stop sharing.
    *   Click "Options" for auto-reconnect, logs, or to open the main options page.

## Troubleshooting

*   **Popup shows "Native Host Issue" or "Could not connect":**
    *   Ensure the **Native Host Application** is installed correctly from Releases.
    *   Check if the native application (e.g., `youtube_music_rpc.exe`) is running (Task Manager/Activity Monitor).
    *   Try re-running the `install.bat` (Windows) or `install.sh` (macOS/Linux) script from the native host installation folder.
    *   Click the "Reconnect" button in the extension popup.
    *   Restart your browser.

*   **Native Host is "Connected" but RPC Status is "Disconnected" or "Connecting...":**
    *   Ensure your Discord desktop client is running and you are logged in.
    *   Native host might have issues with Discord. Check native host logs if available.
    *   Restart Discord, then the native host, then click "Reconnect" in the popup.

*   **Song information is not updating in Discord:**
    *   Make sure the active tab is `music.youtube.com` and a song is playing.
    *   Try refreshing the YouTube Music page.
    *   Check the extension popup for any error messages or status changes.
    *   Open the browser's developer console (F12, then go to "Console") on the YouTube Music page and look for any errors from "[YTMusicRPC Content]".
    *   Also, check the extension's background page console for errors: go to `chrome://extensions`, find the extension, click "Details", then "Inspect views: service worker" (or "background page").
