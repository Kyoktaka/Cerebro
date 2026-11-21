const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

// Sessions survive server restarts (nodemon reloads, crashes, updates). Only
// the account key and timestamps are stored; conversation state is rebuilt
// from the user's file on demand.
const IDLE_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const ID_PATTERN = /^[a-f0-9]{48}$/;

function createSessionStore(dir, loadUser) {
    const file = path.join(dir, 'sessions.json');
    const live = new Map();
    const records = Object.create(null);

    fs.mkdirSync(dir, { recursive: true });
    try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const [id, record] of Object.entries(saved || {})) {
            if (ID_PATTERN.test(id) && typeof record?.lastName === 'string' && Number.isFinite(record.lastSeen)) records[id] = record;
        }
    } catch {}

    function persist() {
        const now = Date.now();
        for (const [id, record] of Object.entries(records)) {
            if (now - record.lastSeen > IDLE_LIMIT_MS) delete records[id];
        }
        const temp = file + '.tmp';
        fs.writeFileSync(temp, JSON.stringify(records));
        fs.renameSync(temp, file);
    }

    function blank(user) {
        return { user, pdfContent: '', pdfNames: [], activePdfNames: [], uploadedPDFs: [], pdfIndex: null, currentConversationId: null };
    }

    function create(user) {
        const id = randomBytes(24).toString('hex');
        const now = Date.now();
        records[id] = { lastName: user.lastName, createdAt: now, lastSeen: now };
        persist();
        const session = blank(user);
        live.set(id, session);
        return id;
    }

    function get(id) {
        if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
        const record = records[id];
        if (!record) return null;
        const now = Date.now();
        if (now - record.lastSeen > IDLE_LIMIT_MS) {
            remove(id);
            return null;
        }
        if (now - record.lastSeen > TOUCH_INTERVAL_MS) {
            record.lastSeen = now;
            try { persist(); } catch {}
        }
        let session = live.get(id);
        if (!session) {
            const user = loadUser(record.lastName);
            if (!user) {
                remove(id);
                return null;
            }
            session = blank(user);
            live.set(id, session);
        }
        return session;
    }

    function remove(id) {
        live.delete(id);
        if (records[id]) {
            delete records[id];
            try { persist(); } catch {}
        }
    }

    function removeUser(lastName) {
        for (const [id, record] of Object.entries(records)) {
            if (record.lastName === lastName) {
                live.delete(id);
                delete records[id];
            }
        }
        try { persist(); } catch {}
    }

    return { create, get, remove, removeUser };
}

module.exports = { createSessionStore, IDLE_LIMIT_MS };
