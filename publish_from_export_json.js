require('dotenv').config();

const fs = require('fs');
const path = require('path');

// ใช้ค่าเดียวกับ server.js
const API_BASE = process.env.API_BASE_URL || 'https://api.bklightstick.bkppentertainment.com/event';

async function main() {
  const [, , fileArg, targetSeatIdArg] = process.argv;

  if (!fileArg || !targetSeatIdArg) {
    console.error('Usage: node publish_from_export_json.js <export_json_path> <target_seat_id>');
    process.exit(1);
  }

  const filePath = path.resolve(fileArg);
  const targetSeatId = String(targetSeatIdArg);

  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
  }

  console.log(`Reading zones from "${filePath}" and publishing to API as seat_id="${targetSeatId}" ...`);

  const raw = fs.readFileSync(filePath, 'utf8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse JSON:', e.message);
    process.exit(1);
  }

  const zones = Array.isArray(payload.zones) ? payload.zones : [];
  if (!zones.length) {
    console.error('No zones[] array found in JSON payload.');
    process.exit(1);
  }

  const name = payload.name || '';
  const maxChannel = parseInt(payload.maxChannel) || 2;
  const model = payload.model || null;

  // แปลงรูปแบบ zones -> zoning body ตามที่ server.js ใช้ใน /api/publish
  const zoning = zones.map((zd, idx) => {
    const zoneId = (zd.model && zd.model.ID) ? zd.model.ID : 0;
    const rawItems = zd.items || [];
    const items = rawItems
      .filter((item, i, arr) => arr.findIndex(x => (x.idIndex ?? 0) === (item.idIndex ?? 0)) === i)
      .sort((a, b) => (a.idIndex ?? 0) - (b.idIndex ?? 0))
      .map(item => ({
        ...(item.model ? { model: item.model } : {}),
        zoningId: item.zoningId || zoneId,
        channel: parseInt(item.channel) || 0,
        name: item.name || '',
        pixelId: parseInt(item.pixelId) || 0,
        ignore: !!item.ignore,
        idIndex: item.idIndex ?? 0,
      }));

    return {
      ...(zd.model ? { model: zd.model } : {}),
      area: (zd.area || '').toUpperCase(),
      isHorizontal: zd.isHorizontal !== false,
      row: parseInt(zd.row) || 0,
      column: parseInt(zd.column) || 0,
      burnId: parseInt(zd.burnId) || 0,
      order: idx,
      channelCount: parseInt(zd.channelCount) || 0,
      channelsString: JSON.stringify(zd.channels || []),
      items,
    };
  });

  let totalSeats = 0;
  zoning.forEach(z => {
    totalSeats += z.items.filter(i => !i.ignore).length;
  });

  const requestBody = {
    ID: targetSeatId,
    seatCount: totalSeats,
    idCount: 0,
    zoning,
    brunCount: 1,
    image: '',
    name,
    model,
    brunItems: JSON.stringify([{ value: 1, title: 'A1' }]),
    maxChannel,
  };

  console.log(`[PUBLISH-FROM-FILE] Sending ${zoning.length} zones, ${totalSeats} seats to ${API_BASE}/seat/save`);

  try {
    const res = await fetch(API_BASE + '/seat/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'languagecode': 'en',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await res.json().catch(() => ({}));
    console.log('API status:', res.status);
    console.log('API ok:', res.ok);
    console.log('API response:', JSON.stringify(data, null, 2).slice(0, 4000)); // ตัดให้สั้นกัน log ยาวเกินไป

    if (!res.ok) {
      process.exitCode = 1;
    }
  } catch (e) {
    console.error('Request failed:', e.message);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

