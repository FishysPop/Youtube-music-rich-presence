// native-host.js (Extremely Simplified Version)
const RPC = require('fixed-discord-rpc');
const clientId = '1242988484671705208'; // Your actual Client ID

// --- Helper for sending messages to the extension ---
function sendToExtension(messageObject) {
    try {
        const jsonMessage = JSON.stringify(messageObject);
        const messageLength = Buffer.byteLength(jsonMessage, 'utf-8');
        const lengthBuffer = Buffer.alloc(4);
        lengthBuffer.writeUInt32LE(messageLength, 0);
        process.stdout.write(lengthBuffer);
        process.stdout.write(jsonMessage);
    } catch (e) {
        // Minimal error handling for sendToExtension itself
        // For debugging the host, you might log to stderr:
        // console.error("Native Host: Failed to send message to extension:", e.message);
    }
}

// --- Input processing from extension ---
let inputBuffer = Buffer.from('');
process.stdin.on('data', (chunk) => {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);
    while (true) {
        if (inputBuffer.length < 4) break; // Not enough data for length
        const messageLength = inputBuffer.readUInt32LE(0);
        if (inputBuffer.length < 4 + messageLength) break; // Not enough data for the full message

        const messageJson = inputBuffer.toString('utf-8', 4, 4 + messageLength);
        inputBuffer = inputBuffer.slice(4 + messageLength); // Consume the message from the buffer

        try {
            const message = JSON.parse(messageJson);
            if (message.type === 'SET_ACTIVITY') {
                setActivity(message.data);
            } else if (message.type === 'CLEAR_ACTIVITY') {
                clearActivity();
            }
        } catch (e) {
            sendToExtension({ type: 'NATIVE_HOST_ERROR', message: `Error parsing message: ${e.message}` });
        }
    }
});

process.stdin.on('end', () => {
    // Stdin stream ended, usually means the browser extension closed the connection.
    shutdownRpcAndExit(0);
});

process.stdin.on('error', (err) => {
    sendToExtension({ type: 'NATIVE_HOST_ERROR', message: `Stdin Error: ${err.message}` });
    // Consider exiting if stdin errors out, as communication is likely broken.
    // shutdownRpcAndExit(1);
});

// --- Discord RPC ---
const rpc = new RPC.Client({ transport: 'ipc' });
let rpcReady = false;

rpc.on('ready', () => {
    rpcReady = true;
    sendToExtension({
        type: 'RPC_STATUS_UPDATE',
        status: 'connected',
        user: { username: rpc.user.username, discriminator: rpc.user.discriminator }
    });
    // You could optionally call clearActivity() here if you want to ensure
    // a clean state on Discord every time the RPC connects, in case Discord
    // remembered a previous state from a quick restart.
    // clearActivity();
});

rpc.on('error', (err) => {
    rpcReady = false;
    sendToExtension({ type: 'RPC_ERROR', message: `RPC Error: ${err.message}` });
    // No automatic reconnect in this "extremely simple" version.
    // The extension or user might need to trigger an action that retries connection.
});

rpc.on('disconnected', () => {
    rpcReady = false;
    sendToExtension({ type: 'RPC_STATUS_UPDATE', status: 'disconnected' });
    // No automatic reconnect.
});

async function connectRpc() {
    if (rpcReady) return; // Already connected or trying
    try {
        // sendToExtension({ type: 'DEBUG_LOG', message: 'Attempting RPC login...' }); // Optional log
        await rpc.login({ clientId });
        // The 'ready' event will handle the success and set rpcReady = true.
    } catch (err) {
        rpcReady = false; // Ensure state reflects failure
        sendToExtension({ type: 'RPC_ERROR', message: `RPC Login Failed: ${err.message}` });
    }
}

async function setActivity(activityData) {
    if (!activityData) {
        // If activityData is null/undefined, treat it as a request to clear activity.
        await clearActivity();
        return;
    }

    if (!rpcReady) {
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'error_rpc_not_ready', message: 'RPC not connected. Cannot set activity.' });
        // Optionally, try to connect if an action is requested and RPC is not ready.
        // This provides a basic way to recover the connection if it was lost.
        connectRpc();
        return;
    }

    try {
        await rpc.setActivity(activityData);
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'success', activity: activityData });
    } catch (err) {
        rpcReady = false; // Assume connection might be lost if setActivity fails
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'error', message: `Failed to set activity: ${err.message}` });
    }
}

async function clearActivity() {
    if (!rpcReady) {
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'error_rpc_not_ready', message: 'RPC not connected. Cannot clear activity.' });
        // Optionally, try to connect if an action is requested.
        connectRpc();
        return;
    }

    try {
        await rpc.clearActivity(); // The core call to clear activity
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'cleared' });
    } catch (err) {
        rpcReady = false; // Assume connection might be lost
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'clear_error', message: `Failed to clear activity: ${err.message}` });
    }
}

function shutdownRpcAndExit(exitCode = 0) {
    // sendToExtension({ type: 'DEBUG_LOG', message: `Native Host: Shutting down with code ${exitCode}.`});
    if (rpc && typeof rpc.destroy === 'function') {
        rpc.destroy()
            .catch(() => { /* Ignore errors on destroy during shutdown */ })
            .finally(() => process.exit(exitCode));
    } else {
        process.exit(exitCode);
    }
}

// --- Initialisation & Signal Handlers ---
sendToExtension({ type: 'NATIVE_HOST_STARTED' });
connectRpc(); // Initial attempt to connect to Discord RPC

process.on('SIGINT', () => { // Ctrl+C
    // sendToExtension({ type: 'DEBUG_LOG', message: 'Native Host: SIGINT received. Shutting down.' });
    shutdownRpcAndExit(0);
});

process.on('SIGTERM', () => { // Termination signal
    // sendToExtension({ type: 'DEBUG_LOG', message: 'Native Host: SIGTERM received. Shutting down.' });
    shutdownRpcAndExit(0);
});
