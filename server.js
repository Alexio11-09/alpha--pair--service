const express = require('express');
const { makeWASocket, Browsers, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const os = require('os');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// Serve the HTML frontend
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.post('/api/pair', async (req, res) => {
    const { number } = req.body;
    const rawNumber = (number || '').replace(/[^0-9]/g, '');
    if (rawNumber.length < 10) return res.status(400).json({ error: 'Invalid number' });

    try {
        const tempDir = path.join(os.tmpdir(), `pair_${rawNumber}_${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        const { state } = await useMultiFileAuthState(tempDir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            auth: state,
            version,
            browser: Browsers.macOS('Chrome'),
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            connectTimeoutMs: 30000
        });

        let pairingCode = null;
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout')), 35000);
            sock.ev.on('connection.update', async (update) => {
                const { connection } = update;
                if (connection === 'connecting' || connection === 'open') {
                    clearTimeout(timeout);
                    try {
                        pairingCode = await sock.requestPairingCode(rawNumber);
                        resolve();
                    } catch (e) { reject(e); }
                }
                if (connection === 'close') {
                    clearTimeout(timeout);
                    reject(new Error('Connection closed'));
                }
            });
        });

        sock.end();
        fs.rmSync(tempDir, { recursive: true, force: true });

        if (!pairingCode) throw new Error('No code');
        res.json({ code: pairingCode });
    } catch (err) {
        console.error('Pair error:', err);
        res.status(500).json({ error: err.message || 'Internal error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pair server running on port ${PORT}`));
