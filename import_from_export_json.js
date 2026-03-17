const fs = require('fs');
const path = require('path');
const db = require('./db');

async function main() {
  const [, , fileArg, targetSeatIdArg] = process.argv;

  if (!fileArg || !targetSeatIdArg) {
    console.error('Usage: node import_from_export_json.js <export_json_path> <target_seat_id>');
    process.exit(1);
  }

  const filePath = path.resolve(fileArg);
  const targetSeatId = String(targetSeatIdArg);

  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
  }

  console.log(`Importing zones from "${filePath}" to seat_id="${targetSeatId}" ...`);

  await db.initDB();

  const raw = fs.readFileSync(filePath, 'utf8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse JSON:', e.message);
    process.exit(1);
  }

  const zones = Array.isArray(payload.zones) ? payload.zones : [];
  const createdBy = payload.name ? `import:${payload.name}` : 'import:export_json';

  if (!zones.length) {
    console.log('No zones found in JSON.');
    process.exit(0);
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    const area = (z && z.area ? String(z.area) : '').toUpperCase();
    if (!area) {
      skipped++;
      continue;
    }

    const zoneData = { ...z };
    if (zoneData.tabOrder === undefined || zoneData.tabOrder === null) {
      zoneData.tabOrder = i;
    }

    try {
      await db.saveZone(targetSeatId, area, zoneData, createdBy);
      ok++;
    } catch (e) {
      failed++;
      console.error(`Failed to save area "${area}" (index ${i}):`, e.message);
    }
  }

  console.log(`Done. Saved: ${ok}, skipped (no area): ${skipped}, failed: ${failed}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

