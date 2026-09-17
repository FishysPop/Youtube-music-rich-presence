# YouTube Music Rich Presence for Discord

![YouTube Music Rich Presence in Discord](https://i.imgur.com/3Bjhcwu.png)

Displays your YouTube Music activity as your Discord Rich Presence and synchronizes real-time playback with friends via Listen Together. This browser extension pairs with a lightweight native companion application to communicate with Discord.

## Prerequisites

- **Supported Browsers:** Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi, Arc (Chromium-based browsers).
- The **YouTube Music Rich Presence Native Host** companion application.

## Installation

Installation requires two components: the Native Host application and the Browser Extension.

### 1. Native Host Application

- Go to the **Releases** page of this repository.
- Download `YouTubeMusicRPCSetup.exe` from the latest release.
- Run `YouTubeMusicRPCSetup.exe` and follow the on-screen installer instructions to register the native messaging host with your browser.
- The companion process (`youtube_music_rpc.exe`) runs automatically in the background when your browser opens YouTube Music.

### 2. Browser Extension

- **Option A: Chrome Web Store (Recommended)**
  - [Chrome Web Store Link](https://chromewebstore.google.com/detail/youtube-music-rich-presen/nnkdglgpmblpcmnojjekboafalidkmkb)
  - _Note for Edge, Brave, and other Chromium users:_ Enable "Allow extensions from other stores" if prompted.
<details>
<summary><strong>Option B: Manual Installation (Sideloading)</strong></summary>

1. Download or clone this repository.
2. Open your browser's extension management page:
   - **Chrome:** `chrome://extensions`
   - **Edge:** `edge://extensions`
   - **Brave:** `brave://extensions`
3. Enable **Developer mode** (toggle in the top-right or sidebar).
4. Click **Load unpacked**.
5. Select the `extention` directory from this repository.
</details>

## Features

- **Listen Together (Listen Along):**
  - **Real-Time Playback Sync:** Synchronize tracks, seeking, and play/pause states with friends across YouTube Music.
  - **Embedded Player Controls:** Built directly into the YouTube Music player bar—no need to switch tabs or open separate tools.
  - **Queue Synchronization:** Automatically mirrors the host's Supermix and radio queues so listeners transition seamlessly between upcoming tracks.
  - **Privacy-Preserving Pure Broker Relay:** All signaling and synchronization data is relayed over TLS WebSockets (`wss://broker.hivemq.com:8884/mqtt`). Participants do not make direct peer-to-peer connections, preventing IP address exposure.
  - **One-Click Invite Links:** Share direct invite links (`https://music.youtube.com/#ytm-session=YTM-XXXXXX` or via the web gateway) that launch YouTube Music and auto-connect to the session.
  - **Discord Party & Join Integration:** Adds an interactive "Listen Along" button and party size indicators to your Discord profile.
  - **Adaptive Drift Compensation:** Smooth playback-rate adjustments eliminate desync without audio stuttering or popping.
  - **Ad Resilience:** Deferral safeguards keep listeners in the room during ads and catch up automatically once normal playback resumes.

- **Discord Rich Presence:**
  - Displays song title, artist, album name, elapsed time, duration, and high-resolution album art.
  - Distinguishes genuine album releases from singles to avoid redundant title text.
  - Outbound rate-limiting and skip coalescing prevent Discord RPC throttling.

- **Interactive Discord Presence Buttons:**
  - **Listen Along:** Lets friends join your Listen Together session directly from Discord.
  - **Link:** Direct link to the track on YouTube Music (with search fallback).
  - **GitHub:** Link to this open-source project.

## Usage

1. **Ensure the Native Host is installed.**
2. **Open YouTube Music** (`music.youtube.com`) in your browser.
3. **Play any track.** Your Discord status updates automatically.
4. **Using Listen Together:**
   - Click the Listen Together icon located on the right side of the bottom player bar on YouTube Music (or click the extension icon in your browser toolbar).
   - Click **Host Session** to create a room. Share your 6-character room code or copy the invite link.
   - To join a friend, paste their room code or link into the join input and click **Join**.

## Troubleshooting

<details>
<summary>Why can't I see the buttons on my own Discord profile?</summary>

Discord does not render interactive Rich Presence buttons to the account broadcasting them. This is a built-in limitation of the Discord desktop and web clients. Other Discord users viewing your profile will see and be able to click the buttons ("Listen Along", "Link", "GitHub") normally.
</details>

<details>
<summary>Popup shows "Native Host Issue" or "Could not connect"</summary>

- Verify the Native Host application is installed by re-running `YouTubeMusicRPCSetup.exe` from Releases.
- Verify `youtube_music_rpc.exe` is present in your installation directory and not blocked by antivirus software.
- Click **Reconnect** inside the extension popup.
- Restart your browser.
</details>

<details>
<summary>Native Host is "Connected" but RPC Status is "Disconnected" or "Connecting..."</summary>

- Ensure your Discord desktop client is actively running and you are logged into your account.
- Discord Rich Presence requires the Discord desktop app; browser-only Discord cannot receive IPC connections.
- In Discord, verify that **Settings > Activity Privacy > Display current activity as a status message** is enabled.
- Restart Discord, then click **Reconnect** in the extension popup.
</details>

<details>
<summary>Song information is not updating in Discord</summary>

- Ensure the active or background tab is `music.youtube.com` and audio is actively playing.
- Refresh the YouTube Music page.
- Open the extension popup to check for status warnings.
- Check Developer Tools (F12 -> Console) on YouTube Music for any logged extension errors.
</details>

<details>
<summary>Listen Together session fails to connect or synchronize</summary>

- Confirm both Host and Listener are on `music.youtube.com`.
- Verify the 6-character room code matches without spaces (e.g., `YTM-ABC123` or `ABC123`).
- If joining from an invite link, ensure your browser has the extension installed and enabled.
- Ensure your network does not block outbound WebSocket connections over port 8884 (`wss://broker.hivemq.com:8884`).
</details>
