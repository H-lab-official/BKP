const { Pool } = require('pg');

const dbName = process.env.PG_DATABASE || 'seat_collab';
const pool = new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || '',
    database: dbName,
});

// สร้าง database ถ้ายังไม่มี (เชื่อม postgres ก่อน แล้วสร้าง)
async function ensureDatabase() {
    const adminPool = new Pool({
        host: process.env.PG_HOST || 'localhost',
        port: parseInt(process.env.PG_PORT || '5432'),
        user: process.env.PG_USER || 'postgres',
        password: process.env.PG_PASSWORD || '',
        database: 'postgres',
    });
    try {
        const res = await adminPool.query(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [dbName]
        );
        if (res.rows.length === 0) {
            await adminPool.query(`CREATE DATABASE "${dbName}"`);
            console.log(`[DB] Created database "${dbName}"`);
        }
    } finally {
        await adminPool.end();
    }
}

// Auto-create table on startup (มีแล้วไม่สร้าง)
async function initDB() {
    await ensureDatabase();
    const query = `
        CREATE TABLE IF NOT EXISTS seat_zones (
            id SERIAL PRIMARY KEY,
            seat_id VARCHAR(50) NOT NULL,
            area VARCHAR(50) NOT NULL,
            zone_data JSONB NOT NULL,
            created_by VARCHAR(100) DEFAULT '',
            status VARCHAR(20) DEFAULT 'draft',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_seat_zones_seat_id ON seat_zones(seat_id);
    `;
    try {
        await pool.query(query);
        console.log('[DB] Table seat_zones ready');
    } catch (err) {
        console.error('[DB] Init error:', err.message);
        throw err;
    }
}

// Get all zones for a seat_id
async function getZones(seatId) {
    const res = await pool.query(
        'SELECT * FROM seat_zones WHERE seat_id = $1 ORDER BY area ASC',
        [seatId]
    );
    return res.rows;
}

// Save or update a zone (upsert by seat_id + area)
async function saveZone(seatId, area, zoneData, createdBy) {
    // Check if exists
    const existing = await pool.query(
        'SELECT id FROM seat_zones WHERE seat_id = $1 AND area = $2',
        [seatId, area.toUpperCase()]
    );

    if (existing.rows.length > 0) {
        // Update
        const res = await pool.query(
            `UPDATE seat_zones
             SET zone_data = $1, created_by = $2, updated_at = NOW()
             WHERE seat_id = $3 AND area = $4
             RETURNING *`,
            [JSON.stringify(zoneData), createdBy, seatId, area.toUpperCase()]
        );
        return res.rows[0];
    } else {
        // Insert
        const res = await pool.query(
            `INSERT INTO seat_zones (seat_id, area, zone_data, created_by)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [seatId, area.toUpperCase(), JSON.stringify(zoneData), createdBy]
        );
        return res.rows[0];
    }
}

// Update zone status
async function updateStatus(id, status) {
    const res = await pool.query(
        'UPDATE seat_zones SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [status, id]
    );
    return res.rows[0];
}

// Delete a zone
async function deleteZone(id) {
    await pool.query('DELETE FROM seat_zones WHERE id = $1', [id]);
}

// Get all "ready" zones for publishing
async function getReadyZones(seatId) {
    const res = await pool.query(
        "SELECT * FROM seat_zones WHERE seat_id = $1 AND status = 'ready' ORDER BY area ASC",
        [seatId]
    );
    return res.rows;
}

// Mark all published
async function markPublished(seatId) {
    await pool.query(
        "UPDATE seat_zones SET status = 'posted', updated_at = NOW() WHERE seat_id = $1 AND status = 'ready'",
        [seatId]
    );
}

module.exports = { pool, initDB, getZones, saveZone, updateStatus, deleteZone, getReadyZones, markPublished };
