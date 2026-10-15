const mysql = require("mysql2/promise");
const fs = require("fs");

const DB = {
  host: "14.225.211.84",
  port: 3306,
  user: "laravel_app_hyte",
  password: "uitT@990912",
  database: "laravel_db_app",
  connectTimeout: 10000,
};

const INPUT = process.argv[2] || "exports/reservations_extracted.json";

function parseDate(d) {
  if (!d) return null;
  const p = d.trim().split(" ")[0].split("/");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : null;
}

function extractEmail(g) {
  const email = (g.guestEmail || "").trim();
  if (email) return email;
  const addr = (g.guestAddress || "").trim();
  if (/^[^@]+@[^@]+\.[^@]+$/.test(addr)) return addr;
  return null;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  console.log(`Loaded ${data.length} reservations from ${INPUT}`);

  const conn = await mysql.createConnection(DB);
  console.log("Connected to MySQL");

  let inserted = 0;
  let skipped = 0;
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const today = new Date().toISOString().slice(0, 10);

  for (const r of data) {
    const roomingList = r.reservationRoomingList || [];

    // 1 row per room (per roomingList entry)
    for (const rl of roomingList) {
      const g = (rl.roomingListGuest || [])[0] || {};
      const rt = (rl.roomingListRoomType || [{}])[0] || {};
      const rate = (rl.roomingListRate || [{}])[0] || {};
      const room = rl.roomingListRoom || {};
      const rateWithTax = (rate.rateAmount || 0) + (rate.rateTax1Amount || 0) + (rate.rateTax2Amount || 0) + (rate.rateTax3Amount || 0);
      const isEmail = /^[^@]+@[^@]+\.[^@]+$/.test(g.guestAddress || "");

      // Skip if reservation_id + roomingListID already exists
      const rlId = rl.roomingListID || null;
      const [existing] = await conn.query(
        "SELECT id FROM ohip_res WHERE reservation_id = ? AND rooming_list_id = ? LIMIT 1",
        [r.reservationID, rlId]
      );
      if (existing.length) { skipped++; continue; }

      const row = {
        hotel_id: null,
        reservation_id: r.reservationID,
        rooming_list_id: rl.roomingListID || null,
        profile_no: String(g.guestID || ""),
        guestno: r.reservationConfirmationNo || null,
        arr_date: parseDate(rl.roomingListArrivalDate),
        dep_date: parseDate(rl.roomingListDepartureDate),
        reservation_date: parseDate(r.reservationBookingDate),
        guest_name: `${g.guestName || ""} ${g.guestLastName || ""}`.trim() || null,
        membership_no: null,
        ttl_rev: null,
        rm_rev: null,
        fb_rev: null,
        other_rev: null,
        rm_rate: rate.rateAmount || null,
        total_rate: rateWithTax || null,
        point_type: null,
        property_code: null,
        market_code: r.reservationSegment || null,
        race_code: g.guestRace || null,
        source_name: r.reservationSource || null,
        room_no: room.roomNo || null,
        room_type: rt.roomTypeCode || null,
        email: isEmail ? g.guestAddress.trim() : extractEmail(g),
        minus_marked: null,
        remark: r.reservationRemarks || null,
        title: g.guestSalutation || null,
        firstname: (g.guestName || "").trim() || null,
        lastname: (g.guestLastName || "").trim() || null,
        booking_status: r.reservationStatus || null,
        membership_no_original: null,
        file_process: "IDB_API",
        process_date: today,
        created_at: now,
        updated_at: now,
        postcode: g.guestPostcode || null,
        city: g.guestCity || null,
        state: null,
        country: r.reservationContactCountry || g.guestCountry || null,
        mobile_number: g.guestMobileNo || r.reservationContactNo1 || null,
        lang: null,
        birthday: parseDate(g.guestBirthdate),
        nationality: g.guestNationality || null,
        gender: g.guestSex || null,
        address: isEmail ? null : (g.guestAddress || null),
        home_number: g.guestTelephoneNo || null,
      };

      const cols = Object.keys(row);
      const vals = Object.values(row);
      const placeholders = cols.map(() => "?").join(",");
      await conn.query(`INSERT INTO ohip_res (${cols.join(",")}) VALUES (${placeholders})`, vals);
      inserted++;
    }
  }

  console.log(`\nDone! Inserted: ${inserted} | Skipped: ${skipped} | Total reservations: ${data.length}`);

  const [count] = await conn.query("SELECT COUNT(*) AS cnt FROM ohip_res");
  console.log(`ohip_res total rows: ${count[0].cnt}`);

  await conn.end();
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
