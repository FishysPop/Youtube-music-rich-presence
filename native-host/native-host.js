const RPC = require('fixed-discord-rpc');
const clientId = '1242988484671705208'; 

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
    shutdownRpcAndExit(0);
});

process.stdin.on('error', (err) => {
    sendToExtension({ type: 'NATIVE_HOST_ERROR', message: `Stdin Error: ${err.message}` });
});

const rpc = new RPC.Client({ transport: 'ipc' });
let rpcReady = false;

rpc.on('ready', () => {
    rpcReady = true;
    sendToExtension({
        type: 'RPC_STATUS_UPDATE',
        status: 'connected',
        user: { username: rpc.user.username, discriminator: rpc.user.discriminator }
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
        await rpc.login({ clientId });
    } catch (err) {
        rpcReady = false; 
        sendToExtension({ type: 'RPC_ERROR', message: `RPC Login Failed: ${err.message}` });
    }
}

async function setActivity(activityData) {
    if (!activityData) {
        await clearActivity();
        return;
    }

    if (!rpcReady) {
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'error_rpc_not_ready', message: 'RPC not connected. Cannot set activity.' });
        connectRpc();
        return;
    }

    try {
        await rpc.setActivity(activityData);
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'success', activity: activityData });
    } catch (err) {
        rpcReady = false; 
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'error', message: `Failed to set activity: ${err.message}` });
    }
}

async function clearActivity() {
    if (!rpcReady) {
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'error_rpc_not_ready', message: 'RPC not connected. Cannot clear activity.' });
        connectRpc();
        return;
    }

    try {
        await rpc.clearActivity(); 
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'cleared' });
    } catch (err) {
        rpcReady = false; 
        sendToExtension({ type: 'ACTIVITY_STATUS', status: 'clear_error', message: `Failed to clear activity: ${err.message}` });
    }
}

function shutdownRpcAndExit(exitCode = 0) {
    if (rpc && typeof rpc.destroy === 'function') {
        rpc.destroy()
            .catch(() => { /* Ignore errors on destroy during shutdown */ })
            .finally(() => process.exit(exitCode));
    } else {
        process.exit(exitCode);
    }
}

sendToExtension({ type: 'NATIVE_HOST_STARTED' });
connectRpc(); 

process.on('SIGINT', () => { 
    shutdownRpcAndExit(0);
});

process.on('SIGTERM', () => {
    shutdownRpcAndExit(0);
});
