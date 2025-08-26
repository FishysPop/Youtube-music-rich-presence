const RPC = require('@xhayper/discord-rpc');
const NATIVE_HOST_VERSION = "1.0.0";
const clientId = '1242988484671705208';
const RPC_LOGIN_TIMEOUT = 30000; // 30 seconds timeout for RPC login
let messageQueue = [];

function sendToExtension(messageObject) {
    try {
        const jsonMessage = JSON.stringify(messageObject);
        const messageLength = Buffer.byteLength(jsonMessage, 'utf-8');
        const lengthBuffer = Buffer.alloc(4);
        lengthBuffer.writeUInt32LE(messageLength, 0);
        process.stdout.write(lengthBuffer);
        process.stdout.write(jsonMessage);
    } catch (e) {
    }
}

let inputBuffer = Buffer.from('');
process.stdin.on('data', (chunk) => {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);
    while (true) {
        if (inputBuffer.length < 4) break; 
        const messageLength = inputBuffer.readUInt32LE(0);
        if (inputBuffer.length < 4 + messageLength) break; 

        const messageJson = inputBuffer.toString('utf-8', 4, 4 + messageLength);
        inputBuffer = inputBuffer.slice(4 + messageLength);

        try {
            const message = JSON.parse(messageJson);
            // Enqueue messages if RPC is not ready, otherwise process them directly.
            // This ensures messages are handled once RPC is initialized and connected.
            if (!rpcReady && message.type !== 'INIT') {
                messageQueue.push(message);
                // Attempt to connect if not already trying
                connectRpc();
            } else {
                switch (message.type) {
                    case 'INIT':
                        // Handle INIT message for explicit connection attempts
                        connectRpc();
                        break;
                    case 'SET_ACTIVITY':
                        setActivity(message.data);
                        break;
                    case 'CLEAR_ACTIVITY':
                        clearActivity();
                        break;
                    case 'RECONNECT_RPC':
                        connectRpc();
                        break;
                    default:
                        sendToExtension({ type: 'NATIVE_HOST_WARNING', message: `Unknown message type: ${message.type}` });
                }
            }
        } catch (e) {
            sendToExtension({ type: 'NATIVE_HOST_ERROR', message: `Error parsing message: ${e.message}` });
        }
    }
});

process.stdin.on('end', () => {
    shutdownRpcAndExit(0);
});

process.stdin.on('error', (err) => {
    sendToExtension({ type: 'NATIVE_HOST_ERROR', message: `Stdin Error: ${err.message}` });
});

const rpc = new RPC.Client({
    clientId: clientId
});
let rpcReady = false;

rpc.on('ready', () => {
    rpcReady = true;
    sendToExtension({
        type: 'RPC_STATUS_UPDATE',
        status: 'connected',
        user: { username: rpc.user.username, discriminator: rpc.user.discriminator }
    });

    // Process queued messages, ensuring only SET_ACTIVITY and CLEAR_ACTIVITY are handled here
    const queue = messageQueue.filter(msg => msg.type === 'SET_ACTIVITY' || msg.type === 'CLEAR_ACTIVITY');
    messageQueue = []; // Clear the queue after processing
    queue.forEach(msg => {
        switch (msg.type) {
            case 'SET_ACTIVITY':
                setActivity(msg.data);
                break;
            case 'CLEAR_ACTIVITY':
                clearActivity();
                break;
        }
    });
});

rpc.on('error', (err) => {
    rpcReady = false;
    sendToExtension({ type: 'RPC_ERROR', message: `RPC Error: ${err.message}` });
});

rpc.on('disconnected', () => {
    rpcReady = false;
    sendToExtension({ type: 'RPC_STATUS_UPDATE', status: 'disconnected' });
});

async function connectRpc() {
    if (rpcReady) return;
    try {
        // Add explicit timeout configuration to the RPC login process
        await rpc.login({
            clientId,
            timeout: RPC_LOGIN_TIMEOUT
        });
    } catch (err) {
        // Enhance error classification to better handle timeout errors
        let errorType = 'UNKNOWN_ERROR';
        let errorMessage = err.message;
        
        // Check if this is a timeout error
        if (err.message && (err.message.includes('timeout') || err.message.includes('TIMED_OUT') || err.message.includes('ETIMEDOUT'))) {
            errorType = 'TIMEOUT_ERROR';
            errorMessage = `Connection timed out after ${RPC_LOGIN_TIMEOUT/1000} seconds`;
        }
        // Check if this is an authentication error
        else if (err.message && (err.message.includes('401') || err.message.includes('Unauthorized') || err.message.includes('AUTHENTICATION_FAILED'))) {
            errorType = 'AUTHENTICATION_ERROR';
            errorMessage = 'Authentication failed - check client ID and Discord credentials';
        }
        
        // Add more detailed error logging for connection failures
        console.error(`RPC Login Failed [${errorType}]:`, {
            errorType,
            errorMessage: err.message,
            stack: err.stack,
            clientId
        });
        
        sendToExtension({
            type: 'RPC_ERROR',
            message: `RPC Login Failed: ${errorMessage}`,
            errorType,
            errorDetails: {
                originalMessage: err.message,
                stack: err.stack
            }
        });
    }
}

async function setActivity(activityData) {
    if (!rpcReady || !rpc.user || typeof rpc.user.setActivity !== 'function') {
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'error', message: 'RPC client not ready or setActivity method is missing.' });
        return;
    }

    if (!activityData) {
        await clearActivity();
        return;
    }

    try {
        await rpc.user.setActivity(activityData);
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'success', activity: activityData });
    } catch (err) {
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'error', message: `Failed to set activity: ${err.message}` });
    }
}

async function clearActivity() {
    if (!rpcReady || !rpc.user || typeof rpc.user.setActivity !== 'function') {
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'clear_error', message: 'RPC client not ready or setActivity method is missing for clear.' });
        return;
    }
    try {
        await rpc.user.setActivity({});
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'cleared' });
    } catch (err) {
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'clear_error', message: `Failed to clear activity: ${err.message}` });
    }
}

function shutdownRpcAndExit(exitCode = 0) {
    if (rpc && rpc.user && typeof rpc.user.destroy === 'function') {
        rpc.user.destroy()
            .catch(() => { /* Ignore errors on destroy during shutdown */ })
            .finally(() => process.exit(exitCode));
    } else {
        process.exit(exitCode);
    }
}

sendToExtension({ type: 'NATIVE_HOST_STARTED', version: NATIVE_HOST_VERSION });
connectRpc(); 

process.on('SIGINT', () => { 
    shutdownRpcAndExit(0);
});

process.on('SIGTERM', () => {
    shutdownRpcAndExit(0);
});
