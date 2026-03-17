require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5173;
const API_BASE = process.env.API_BASE_URL || 'https://api.bklightstick.bkppentertainment.com/event';

app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// API Routes
// ============================================================

// GET /api/zones?seat_id=6 (optional: omit for All Seat ID)
app.get('/api/zones', async (req, res) => {
    try {
        const seatId = req.query.seat_id;
        const zones = seatId ? await db.getZones(seatId) : await db.getAllZones();
        res.json(zones);
    } catch (err) {
        console.error('[GET /api/zones]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/zones
app.post('/api/zones', async (req, res) => {
    try {
        const { seat_id, area, zone_data, created_by } = req.body;
        if (!seat_id || !area) return res.status(400).json({ error: 'seat_id and area required' });
        const zone = await db.saveZone(seat_id, area, zone_data, created_by || '');
        res.json(zone);
    } catch (err) {
        console.error('[POST /api/zones]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/zones/:id/status
app.put('/api/zones/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        if (!['draft', 'ready', 'posted'].includes(status)) {
            return res.status(400).json({ error: 'status must be draft, ready, or posted' });
        }
        const zone = await db.updateStatus(req.params.id, status);
        if (!zone) return res.status(404).json({ error: 'not found' });
        res.json(zone);
    } catch (err) {
        console.error('[PUT /api/zones/:id/status]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/zones/:id
app.delete('/api/zones/:id', async (req, res) => {
    try {
        await db.deleteZone(req.params.id);
        res.json({ ok: true });
    } catch (err) {
        console.error('[DELETE /api/zones/:id]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/zones/copy - Push zones from Seat A to Seat B
app.post('/api/zones/copy', async (req, res) => {
    try {
        const { source_seat_id, target_seat_id, created_by, overwrite } = req.body;
        if (!source_seat_id || !target_seat_id) {
            return res.status(400).json({ error: 'source_seat_id and target_seat_id required' });
        }
        if (source_seat_id === target_seat_id) {
            return res.status(400).json({ error: 'Source and target Seat ID must be different' });
        }
        const result = await db.copyZonesToSeat(source_seat_id, target_seat_id, created_by || '', !!overwrite);
        const msg = overwrite
            ? `Copied ${result.copied} zone(s) to Seat ID ${target_seat_id} (overwritten ${result.overwritten}, skipped ${result.skipped})`
            : `Copied ${result.copied} zone(s) to Seat ID ${target_seat_id} (skipped ${result.skipped} existing area(s))`;
        res.json({
            success: true,
            totalSource: result.totalSource,
            copied: result.copied,
            skipped: result.skipped,
            overwritten: result.overwritten,
            message: msg
        });
    } catch (err) {
        console.error('[POST /api/zones/copy]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/zones/reorder - Update tabOrder for all zones
app.put('/api/zones/reorder', async (req, res) => {
    try {
        const { seat_id, orders } = req.body;
        if (!seat_id || !orders) return res.status(400).json({ error: 'seat_id and orders required' });
        await db.updateZoneOrders(seat_id, orders);
        res.json({ ok: true });
    } catch (err) {
        console.error('[PUT /api/zones/reorder]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/publish - Combine ALL zones and POST to real API
app.post('/api/publish', async (req, res) => {
    try {
        const { seat_id, name, maxChannel, brunCount, model } = req.body;
        if (!seat_id) return res.status(400).json({ error: 'seat_id required' });

        const allZones = await db.getZones(seat_id);
        if (allZones.length === 0) {
            return res.status(400).json({ error: 'No zones found for this seat_id' });
        }

        allZones.sort((a, b) => (a.zone_data.tabOrder ?? 999) - (b.zone_data.tabOrder ?? 999));

        // Build zoning array from ALL zones (sorted by tab order)
        // IMPORTANT: items must be sorted by idIndex for correct position mapping (set 1, set 2)
        const seatIdInt = parseInt(seat_id);
        const zoning = allZones.map((row, idx) => {
            const zd = row.zone_data;
            // Check if zone_data belongs to this seat - if not, strip model IDs
            const isOwnData = !zd.seatId || parseInt(zd.seatId) === seatIdInt;
            const zoneModel = (isOwnData && zd.model) ? zd.model : null;
            const zoneId = (zoneModel && zoneModel.ID) ? zoneModel.ID : 0;
            const rawItems = zd.items || [];
            // Deduplicate by idIndex (keep first), then sort by idIndex for correct position
            const items = rawItems
                .filter((item, i, arr) => arr.findIndex(x => (x.idIndex ?? 0) === (item.idIndex ?? 0)) === i)
                .sort((a, b) => (a.idIndex ?? 0) - (b.idIndex ?? 0))
                .map(item => {
                    const isIgnored = !!item.ignore;
                    const itemModel = (isOwnData && item.model) ? item.model : null;
                    return {
                        ...(itemModel ? { model: itemModel } : {}),
                        zoningId: isOwnData ? (item.zoningId || zoneId) : 0,
                        channel: isIgnored ? 0 : (parseInt(item.channel) || 0),
                        name: item.name || '',
                        pixelId: isIgnored ? 0 : (parseInt(item.pixelId) || 0),
                        ignore: isIgnored,
                        idIndex: item.idIndex ?? 0
                    };
                });

            // Build channelsString - ensure correct format: [{"max":N,"min":N,"name":N}]
            let channelsString = '[]';
            if (zd.channelsString && typeof zd.channelsString === 'string') {
                channelsString = zd.channelsString;
            } else if (Array.isArray(zd.channels) && zd.channels.length > 0) {
                const channels = zd.channels.map(ch => ({
                    max: parseInt(ch.max) || 0,
                    min: parseInt(ch.min) || 1,
                    name: parseInt(ch.name) || 0
                }));
                channelsString = JSON.stringify(channels);
            }

            return {
                ...(zoneModel ? { model: zoneModel } : {}),
                area: row.area.toUpperCase(),
                isHorizontal: zd.isHorizontal !== false,
                row: parseInt(zd.row) || 0,
                column: parseInt(zd.column) || 0,
                burnId: parseInt(zd.burnId) || 0,
                seatId: seatIdInt,
                order: idx,
                columnType: parseInt(zd.columnType) || 0,
                rowType: parseInt(zd.rowType) || 0,
                rowFixedValue: zd.rowFixedValue || '',
                columnFixedValue: zd.columnFixedValue || '',
                channelsString: channelsString,
                seatCount: parseInt(zd.seatCount) || 0,
                channelCount: parseInt(zd.channelCount) || 0,
                items
            };
        });

        // Calculate total
        let totalSeats = 0;
        zoning.forEach(z => {
            totalSeats += z.items.filter(i => !i.ignore).length;
        });

        const requestBody = {
            ID: seatIdInt,
            seatCount: totalSeats,
            idCount: 0,
            zoning: zoning,
            brunCount: parseInt(brunCount) || 1,
            image: '',
            name: name || '',
            model: model || null,
            pixel: 0,
            brunItems: JSON.stringify([{ value: 1, title: 'A1' }]),
            maxChannel: parseInt(maxChannel) || 2
        };

        const modifiedAreas = allZones.filter(z => z.status !== 'posted').map(z => z.area);
        const unchangedAreas = allZones.filter(z => z.status === 'posted').map(z => z.area);

        console.log(`[PUBLISH] Sending ${zoning.length} zones (${modifiedAreas.length} modified, ${unchangedAreas.length} unchanged), ${totalSeats} seats to ${API_BASE}/seat/save`);

        const apiRes = await fetch(API_BASE + '/seat/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'languagecode': 'en'
            },
            body: JSON.stringify(requestBody)
        });

        const apiData = await apiRes.json();

        if (apiRes.ok) {
            await db.markAllPublished(seat_id);
            console.log('[PUBLISH] Success:', apiData);
        }

        res.json({
            success: apiRes.ok,
            apiStatus: apiRes.status,
            apiResponse: apiData,
            sentBody: requestBody,
            modifiedAreas,
            unchangedAreas
        });
    } catch (err) {
        console.error('[POST /api/publish]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/proxy/seat?id=6 - Proxy to real API (bypass CORS)
app.get('/api/proxy/seat', async (req, res) => {
    try {
        const id = req.query.id;
        if (!id) return res.status(400).json({ error: 'id required' });

        const apiRes = await fetch(API_BASE + '/seat/getOne?id=' + id, {
            headers: { 'languagecode': 'en' }
        });
        const data = await apiRes.json();
        res.json(data);
    } catch (err) {
        console.error('[GET /api/proxy/seat]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Start Server
// ============================================================
async function start() {
    try {
        await db.initDB();
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n  Seat Collab Server running at:`);
            console.log(`  → http://localhost:${PORT}`);
            console.log(`  → API proxy target: ${API_BASE}`);
            console.log(`  → DB: ${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DATABASE}\n`);
        });
    } catch (err) {
        console.error('Failed to start:', err.message);
        process.exit(1);
    }
}

start();
