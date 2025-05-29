# YouTube Music Rich Presence for Discord

Displays your currently playing song from YouTube Music as your Discord Rich Presence status. This Chrome extension works in conjunction with a native host application to communicate with your Discord client.

## Features

*   **Real-time Updates:** Shows the song, artist, and album art currently playing on YouTube Music.
*   **Discord Integration:** Updates your Discord status to reflect your listening activity.
*   **Informative Popup:**
    *   Displays connection status for the Native Host and Discord RPC.
    *   Shows the currently detected song.
    *   Provides a "Reconnect" button to re-establish connection with the native host.
    *   Includes a "Disconnect" button to manually stop sharing your activity.
    *   Offers an "Options" button to access:
        *   An inline panel to toggle "Auto Reconnect" for the native host.
        *   A brief in-popup error log for quick diagnostics.
        *   (Also attempts to open the main extension options page).
*   **Native Host Helper:** Warns if the native host application is not detected and provides a direct download link.
*   **Interactive Presence:** Includes buttons in your Discord presence to:
    *   Link directly to the song on YouTube Music.
    *   Link to this project's GitHub page.

## How it Works

The system consists of two main parts:

1.  **Chrome Extension (this project's `/extention` folder):**
    *   A **content script** runs on `music.youtube.com` pages to identify the current track, artist, and album art.
    *   A **background script** manages the overall logic, communicates with the content script, and interfaces with the native host application.
    *   A **popup UI** allows you to see the status and control basic functions.

2.  **Native Host Application (companion program):**
    *   This is a separate executable that the Chrome extension communicates with.
    *   It is responsible for interacting directly with your Discord client to update the Rich Presence status.
    *   You need to download and install this from the releases page of this repository.

## Prerequisites

*   A Chromium-based web browser (e.g., Google Chrome, Microsoft Edge, Brave).
*   The **YouTube Music Rich Presence Native Host** application.

## Installation

There are two components to install: the Native Host application and the Chrome Extension.

**1. Native Host Application**

   *   Go to the **Releases Page** of this GitHub repository.
   *   Download the appropriate `.zip` file for your operating system (e.g., `win-x64.zip` for Windows).
   *   Extract the downloaded archive to a permanent location on your computer.
   *   Run the `install.bat` (for Windows) or `install.sh` (for macOS/Linux) script found within the extracted folder. This script registers the native messaging host with your browser.
   *   **Why is an installer script needed?**
       *   **Browser Security:** For security reasons, Chrome extensions cannot directly run local programs on your computer.
       *   **Native Messaging Host Registration:** To allow this extension to communicate with the helper application, the helper application must be registered with your browser. This is a standard mechanism called "Native Messaging."
       *   **What the script does:** The `install.bat`/`install.sh` script creates a small manifest file (a JSON configuration file) in a specific directory that your browser checks. This manifest tells the browser the path to the `youtube_music_rpc` executable and which extension ID (this one) is allowed to connect to it. This is a secure and standard procedure defined by browser vendors for such inter-process communication.
       *   You can inspect the `install.bat` or `install.sh` script in a text editor before running it to see exactly what it does. It primarily writes this JSON manifest file to the appropriate system location.
   *   After running the installer script, ensure the native application (e.g., `youtube_music_rpc.exe` on Windows) is running. Some versions might start automatically or run in the background, while others may need to be launched manually after each system startup.

**2. Chrome Extension**

   *   **Option A: From Chrome Web Store (Recommended when available)**
      *   *(This extension is not yet published on the Chrome Web Store. When it is, the link will be provided here.)*

   *   **Option B: Manual Installation (Sideloading)**
      1.  Download this GitHub repository (e.g., via "Code" -> "Download ZIP") or clone it.
      2.  Extract the ZIP file if you downloaded it.
      3.  Open your Chrome-based browser and navigate to the extensions page: `chrome://extensions`
      4.  Enable **"Developer mode"** (usually a toggle switch in the top-right corner).
      5.  Click the **"Load unpacked"** button.
      6.  In the file dialog, navigate to the folder where you downloaded/cloned the repository and select the `extention` subfolder (this is the folder containing `manifest.json`, `popup.html`, etc.).
      7.  The "YouTube Music Rich Presence" extension should now appear in your list of installed extensions and be active.

## Usage

1.  **Start the Native Host:** Ensure the native host application you installed is running.
2.  **Enable the Extension:** Make sure the "YouTube Music Rich Presence" extension is enabled in `chrome://extensions`.
3.  **Play Music:** Open YouTube Music in a browser tab and start playing a song.
4.  **Check Discord:** Your Discord status should automatically update to show the song you're listening to.
5.  **Use the Popup:**
    *   Click the extension's icon in your browser toolbar.
    *   You'll see the connection status for the "Native Host" and "Discord RPC", along with the "Current Song".
    *   If you encounter issues, use the "Reconnect" button.
    *   To stop sharing your activity, use the "Disconnect" button.
    *   Click the "Options" button to toggle auto-reconnect settings or view recent logs in an inline panel. This also attempts to open the main extension options page.

## Troubleshooting

*   **Popup shows "Native Host Issue" or "Could not connect":**
    *   Verify that you have downloaded and correctly installed the **Native Host Application** from the Releases Page.
    *   Ensure the native application (e.g., `youtube_music_rpc.exe`) is actually running. Check your system's Task Manager or activity monitor.
    *   Try re-running the `YouTubeMusicRPCSetup.exe`
    *   Click the "Reconnect" button in the extension popup.
    *   Restart your browser.

*   **Native Host is "Connected" but RPC Status is "Disconnected" or "Connecting...":**
    *   Ensure your Discord desktop client is running and you are logged in.
    *   The native host might be having trouble communicating with Discord. Check for any console output or logs from the native host application if available.
    *   Try restarting Discord, then the native host application, and finally click "Reconnect" in the extension popup.

*   **Song information is not updating in Discord:**
    *   Make sure the active tab is `music.youtube.com` and a song is playing.
    *   Try refreshing the YouTube Music page.
    *   Check the extension popup for any error messages or status changes.
    *   Open the browser's developer console (F12, then go to "Console") on the YouTube Music page and look for any errors from "[YTMusicRPC Content]".
    *   Also, check the extension's background page console for errors: go to `chrome://extensions`, find the extension, click "Details", then "Inspect views: service worker" (or "background page").
