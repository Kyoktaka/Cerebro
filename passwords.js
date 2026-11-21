const { scryptSync, randomBytes, timingSafeEqual } = require('node:crypto');

// Passwords are stored as scrypt hashes. Accounts made before hashing hold the
// plain password; it still signs in once and is then replaced by a hash.
const PREFIX = 'scrypt:';

function hashPassword(password) {
    const salt = randomBytes(16);
    return PREFIX + salt.toString('hex') + ':' + scryptSync(String(password), salt, 32).toString('hex');
}

function sameBytes(a, b) {
    return a.length === b.length && timingSafeEqual(a, b);
}

function checkPassword(stored, password) {
    if (typeof stored !== 'string' || typeof password !== 'string') return { ok: false };
    if (!stored.startsWith(PREFIX)) {
        return { ok: sameBytes(Buffer.from(stored), Buffer.from(password)), legacy: true };
    }
    const [saltHex, hashHex] = stored.slice(PREFIX.length).split(':');
    if (!saltHex || !hashHex) return { ok: false };
    const expected = Buffer.from(hashHex, 'hex');
    return { ok: sameBytes(scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length), expected), legacy: false };
}

// Slows down guessing: after too many misses an account is locked for a while.
function createThrottle(limit = 8, windowMs = 10 * 60 * 1000) {
    const misses = new Map();
    return {
        blocked(key) {
            const entry = misses.get(key);
            if (entry && Date.now() - entry.first > windowMs) misses.delete(key);
            return (misses.get(key)?.count || 0) >= limit;
        },
        miss(key) {
            const entry = misses.get(key) || { count: 0, first: Date.now() };
            entry.count++;
            misses.set(key, entry);
        },
        clear(key) {
            misses.delete(key);
        }
    };
}

module.exports = { hashPassword, checkPassword, createThrottle };
