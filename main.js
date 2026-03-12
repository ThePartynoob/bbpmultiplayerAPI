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

function getLevenshteinDistance(a, b) {
    const matrix = Array.from({ length: a.length + 1 }, (_, i) => 
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // Deletion
                matrix[i][j - 1] + 1,      // Insertion
                matrix[i - 1][j - 1] + cost // Substitution
            );
        }
    }
    return matrix[a.length][b.length];
}

function isBanned(input, bannedList) {
    // 1. Normalize the string: Lowercase and swap common symbols
    let cleanInput = input.toLowerCase()
        .replace(/@/g, 'a')
        .replace(/1/g, 'i')
        .replace(/!/g, 'i')
        .replace(/0/g, 'o')
        .replace(/3/g, 'e')
        .replace(/\$/g, 's');

    for (const Word of bannedList) {
        // 2. Check for exact match after normalization
        if (cleanInput === Word["Word"]) return true;

        // 3. Check Levenshtein Distance
        // If the word is long, we allow 1 or 2 typos.
        const distance = getLevenshteinDistance(cleanInput, Word["Word"]);
        const threshold = Word["Word"].length > 5 ? 3 : 2; 
        console.log(Word["Word"], distance)
        if (distance <= threshold) return true;
    }

    return false;
}

async function checkUsernameBad(username) {
    var badWordsList = await pool.query('SELECT "Word" FROM public."BadWords"');
    var isusernamebanned = isBanned(username,badWordsList.rows)
    console.log(isusernamebanned);
    
    return isusernamebanned;


}

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
    return true
}

app.get('/checklobbiesheartbeat', async (req,res) => {
    await DeleteOldLobbies();
    res.status(200);
})

app.post('/heartbeat',heartbeat, async (req, res) => {
    DeleteOldLobbies();
    const { code } = req.query;
    console.log(`Received heartbeat for code: ${code}`);
    await pool.query('UPDATE lobbies SET lastupdated = NOW() WHERE code = $1', [code]);
    res.json({ success: true });
    
});

app.get('/BadWordChecker', async (req,res) => {
    const {username} = req.query;
    var currentusername = username
    var isitBad = await checkUsernameBad(username);

    if (isitBad) {
        currentusername = `[REDACTED-${Math.round(Math.random()*1000)}]`
    }


    res.json({ filteredUsername: currentusername});
})

app.get('/lobby',getLobbyInfo, async (req, res) => {
    DeleteOldLobbies();
    const { code } = req.query;
    console.log(`Received lobby info request for code: ${code}`);
    const result = await pool.query('SELECT ip, port FROM lobbies WHERE code = $1', [code]);
    res.json(result.rows[0]);
    
});

app.get('/lobbysettings',getLobbyInfo, async (req, res) => {
    DeleteOldLobbies();
    const { code } = req.query;
    console.log(`Received lobby info settings request for code: ${code}`);
    const result = await pool.query('SELECT lobbysettings FROM lobbies WHERE code = $1', [code]);
    res.json(result.rows[0]);
    
});

app.all('/IsApiUp', (req, res) => {
    res.json({ success: true });
});

app.all('/privacy-policy', (req, res) => {
    res.sendFile( __dirname + "/privacy-policy.html");
    
});

app.get('/GetAssets', Normalrate, (req,res) =>{
    res.download(__dirname + "/sprites.zip", "sprites.zip")
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
    const { ip, port, settings } = req.body;

    // Basic validation to ensure data was sent
    if (!ip || !port || !settings) {
        return res.status(400).json({ error: 'Please provide both ip, port and lobby settings.' });
    }

    if (port <= 0 || port > 65535) {
        return res.sendStatus(400).send("Bad request");
    }

    const randomCode = generateCode();

    console.log(`Code requested for ${ip}:${port} with settings ${settings}`);

    // Respond with the code
    res.json({
        success: true,
        code: randomCode,
        settings: settings
    });

    pool.query('INSERT INTO lobbies (code,ip,port,lobbysettings) VALUES ($1,$2,$3,$4)', [randomCode,ip,port,settings])
        .then(() => {
            console.log(`Lobby created with code ${randomCode} for ${ip}:${port}`);
    })
   

});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});