const express = require('express');
const ratelimit = require('express-rate-limit');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }

})
var Normalrate = ratelimit.rateLimit({
    windowMs: 2 *60*1000,
    limit: 10
})
var heartbeat = ratelimit.rateLimit({
    windowMs: 1 *60*1000,
    limit: 20
})
var getLobbyInfo = ratelimit.rateLimit({
    windowMs: 2.5 *60*1000,
    limit: 15
})
var getstatus = ratelimit.rateLimit({
    windowMs: 2.5 *60*1000,
    limit: 30
})
// Middleware to parse JSON bodies
app.use(express.json());

// Helper to generate a random code
const generateCode = (length = 8) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};
async function DeleteOldLobbies() {
    await pool.query(`DELETE FROM lobbies WHERE lastupdated < NOW() - INTERVAL '5 minutes'`);
}

app.get('/checklobbiesheartbeat', async (req,res) => {
    DeleteOldLobbies();
})

app.post('/heartbeat',heartbeat, async (req, res) => {
    DeleteOldLobbies();
    const { code } = req.query;
    console.log(`Received heartbeat for code: ${code}`);
    await pool.query('UPDATE lobbies SET lastupdated = NOW() WHERE code = $1', [code]);
    res.json({ success: true });
    
});

app.get('/lobby',getLobbyInfo, async (req, res) => {
    DeleteOldLobbies();
    const { code } = req.query;
    console.log(`Received lobby info request for code: ${code}`);
    const result = await pool.query('SELECT ip, port FROM lobbies WHERE code = $1', [code]);
    res.json(result.rows[0]);
    
});

app.all('/IsApiUp', (req, res) => {
    res.json({ success: true });
});

app.all('/privacy-policy', (req, res) => {
    res.sendFile( __dirname + "/privacy-policy.html");
});

app.get('/StatusUpdate',getstatus,async (req,res) => {
    const result = await pool.query('SELECT * FROM "StatusUpdate" ORDER BY id DESC FETCH FIRST 1 ROW ONLY;')
    res.json({currentstatus: result.rows[0]["text"]});
})

app.get('/CheckImportantStuff',getstatus,async (req,res) => {
    const result = await pool.query('SELECT * FROM "importantinfo";')
    res.json(result.rows[0]);
})

app.post('/requestcode',Normalrate, (req, res) => {
    DeleteOldLobbies();
    console.log('Received code request:', req.body);
    const { ip, port } = req.body;

    // Basic validation to ensure data was sent
    if (!ip || !port) {
        return res.status(400).json({ error: 'Please provide both ip and port.' });
    }

    if (port <= 0 || port > 65535) {
        return res.sendStatus(400).send("Bad request");
    }

    const randomCode = generateCode();

    console.log(`Code requested for ${ip}:${port}`);

    // Respond with the code
    res.json({
        success: true,
        code: randomCode
    });

    pool.query('INSERT INTO lobbies (code,ip,port) VALUES ($1,$2,$3)', [randomCode,ip,port])
        .then(() => {
            console.log(`Lobby created with code ${randomCode} for ${ip}:${port}`);
    })
   

});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});