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

// Get all zones for a seat_id (sorted by tabOrder, then area)
async function getZones(seatId) {
    const res = await pool.query(
        "SELECT * FROM seat_zones WHERE seat_id = $1 ORDER BY COALESCE((zone_data->>'tabOrder')::int, 999) ASC, area ASC",
        [seatId]
    );
    return res.rows;
}

// Get all zones from all seat_ids (for "All Seat ID" view)
async function getAllZones() {
    const res = await pool.query(
        `SELECT * FROM seat_zones
         ORDER BY seat_id ASC, COALESCE((zone_data->>'tabOrder')::int, 999) ASC, area ASC`
    );
    return res.rows;
}

// Copy all zones from source_seat_id to target_seat_id (push Seat A → Seat B)
// NOTE: เพื่อป้องกันข้อมูลหาย โซนที่ Seat B มี area ซ้ำอยู่แล้วจะถูก "ข้าม" (skip) ไม่ overwrite
async function copyZonesToSeat(sourceSeatId, targetSeatId, createdBy, overwrite = false) {
    const sourceZones = await getZones(sourceSeatId);
    // ดึงเฉพาะ area ที่มีอยู่แล้วใน target เพื่อตัดสินใจ skip/overwrite
    const existingRes = await pool.query(
        'SELECT DISTINCT area FROM seat_zones WHERE seat_id = $1',
        [targetSeatId]
    );
    const existingAreas = new Set(
        existingRes.rows.map(r => (r.area || '').toUpperCase())
    );

    let copied = 0;
    let skipped = 0;
    let overwritten = 0;
    const zones = [];

    for (const row of sourceZones) {
        const areaUpper = (row.area || '').toUpperCase();
        if (!areaUpper) {
            skipped++;
            continue;
        }
        if (existingAreas.has(areaUpper)) {
            if (!overwrite) {
                skipped++;
                continue;
            }
            // overwrite: saveZone does upsert
            overwritten++;
        }
        // Strip model IDs so API creates new records for the target seat
        const cleanData = JSON.parse(JSON.stringify(row.zone_data));
        delete cleanData.model;
        cleanData.seatId = parseInt(targetSeatId) || 0;
        if (Array.isArray(cleanData.items)) {
            cleanData.items = cleanData.items.map(item => {
                const { model, zoningId, ...rest } = item;
                return { ...rest, zoningId: 0 };
            });
        }
        const zone = await saveZone(
            targetSeatId,
            areaUpper,
            cleanData,
            createdBy || row.created_by || ''
        );
        zones.push(zone);
        copied++;
    }

    return {
        totalSource: sourceZones.length,
        copied,
        skipped,
        overwritten,
        zones,
    };
}

// Save or update a zone (upsert by seat_id + area)
async function saveZone(seatId, area, zoneData, createdBy) {
    // Check if exists
    const existing = await pool.query(
        'SELECT id FROM seat_zones WHERE seat_id = $1 AND area = $2',
        [seatId, area.toUpperCase()]
    );

    if (existing.rows.length > 0) {
        const res = await pool.query(
            `UPDATE seat_zones
             SET zone_data = $1, created_by = $2, status = 'draft', updated_at = NOW()
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

// Mark ALL zones as posted (used after publishing all zones)
async function markAllPublished(seatId) {
    await pool.query(
        "UPDATE seat_zones SET status = 'posted', updated_at = NOW() WHERE seat_id = $1",
        [seatId]
    );
}

// Update tabOrder in zone_data for all zones of a seat_id
async function updateZoneOrders(seatId, orders) {
    for (const { area, tabOrder } of orders) {
        await pool.query(
            `UPDATE seat_zones
             SET zone_data = jsonb_set(zone_data, '{tabOrder}', $1::jsonb), updated_at = NOW()
             WHERE seat_id = $2 AND area = $3`,
            [JSON.stringify(tabOrder), seatId, area.toUpperCase()]
        );
    }
}

module.exports = { pool, initDB, getZones, getAllZones, saveZone, copyZonesToSeat, updateStatus, deleteZone, getReadyZones, markPublished, markAllPublished, updateZoneOrders };
