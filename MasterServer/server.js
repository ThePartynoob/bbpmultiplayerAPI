const express = require('express');
const net = require('net');
const { exec, execSync } = require('child_process');
const START_PORT = 8081;                  // Start checking from port 8081
const MAX_PORT = 8100;       
const PORT = 8080;
const SERVER_IP = "35.225.5.178"
const lockedPorts = new Set();
const app = express()
// Helper function to check if Docker desktop has a container with this port name active
function isDockerPortTaken(port) {
    try {
        const output = execSync('docker ps --format "{{.Names}}"', { encoding: 'utf-8' });
        // Checks if any running container is named exactly "lobby_8081", "lobby_8082", etc.
        return output.includes(`lobby_${port}`);
    } catch (err) {
        console.error("Could not check Docker containers:", err.message);
        return false; // Fallback to network check if docker command fails
    }
}

// Helper function to check if the Windows network layer is free
function isNetworkPortFree(port) {
    return new Promise((resolve) => {
        const tester = net.createServer()
            .once('error', () => resolve(false)) // Taken if it errors out
            .once('listening', () => {
                tester.once('close', () => resolve(true)).close(); // Free! Close it immediately
            })
            .listen(port, '0.0.0.0');
    });
}

// Main function to scan through your port range
async function getNextAvailablePort() {
    for (let port = START_PORT; port <= MAX_PORT; port++) {
        // 1. First, check if Docker is already running a container with this port name
        if (isDockerPortTaken(port)) {
            console.log(`Port ${port} is taken by an active Docker container name.`);
            continue; // Skip to the next port
        }

        // 2. Second, check if the network port itself is free
        const networkFree = await isNetworkPortFree(port);
        if (!networkFree) {
            console.log(`Port ${port} is taken at the network layer.`);
            continue; // Skip to the next port
        }

        // If it passes both checks, it's safe to use!
        return port;
    }
    return null; // All ports full
}

app.get("/createlobby", async (req,res) => {
    const asignnedPort = await getNextAvailablePort()
    if (!asignnedPort) {
        console.log("[warn] no more slots left")
        res.status(503).send("SERVERS_FULL")

    } else {
        const dockerCMD = `docker run -d -p ${asignnedPort}:8080 --rm --name lobby_${asignnedPort} partynoob/bbpmultiplayer:latest`
        exec(dockerCMD, (error, stdout, stderr) => {
        if (error) {
            console.error(`[ERROR] Failed to start Docker container: ${error.message}`);
            return res.status(500).send('FAILED_TO_START_LOBBY');
        }

        console.log(`[SUCCESS] Lobby started on port ${asignnedPort}. ID: ${stdout.trim().substring(0, 12)}`);
        
        // 4. Return the connection string right back to the game client
        res.status(200).send(`${SERVER_IP}:${asignnedPort}`);
    });
    }
})
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Express Master Server running on port ${PORT}...`);
});