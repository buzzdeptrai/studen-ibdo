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

function roomNights(arr, dep) {
  const a = parseDate(arr), b = parseDate(dep);
  if (!a || !b) return 1;
  const n = Math.round((new Date(b) - new Date(a)) / 86400000);
  return n > 0 ? n : 1;
}

// Revenue component -> gross (incl tax). IDB returns { net, tax } or total { net, tax, gross }
function revGross(x) {
  if (!x || typeof x !== "object") return 0;
  if (x.gross != null) return Number(x.gross) || 0;
  return (Number(x.net) || 0) + (Number(x.tax) || 0);
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

      // --- Revenue (incl tax = net + tax). Primary: roomingListRevenue; fallback: rate-based whole stay ---
      const rev = rl.roomingListRevenue || {};
      const hasRev = rev.roomRevenue != null || rev.fnbRevenue != null || rev.otherRevenue != null;
      const roomRev = hasRev ? revGross(rev.roomRevenue) : rateWithTax * roomNights(rl.roomingListArrivalDate, rl.roomingListDepartureDate);
      const fnbRev = revGross(rev.fnbRevenue);
      const otherRev = revGross(rev.otherRevenue);
      // manual_total = sum of ALL revenue components except `total` (incl statutory, ioRevenue, nonHotelRevenue)
      const manualTotal = hasRev
        ? Object.keys(rev).filter((k) => k !== "total").reduce((s, k) => s + revGross(rev[k]), 0)
        : roomRev + fnbRev + otherRev;
      const apiTotal = rev.total != null ? revGross(rev.total) : NaN;
      const ttlRev = (!isNaN(apiTotal) && apiTotal >= manualTotal) ? apiTotal : manualTotal;

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
        ttl_rev: ttlRev,
        rm_rev: roomRev,
        fb_rev: fnbRev,
        other_rev: otherRev,
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
