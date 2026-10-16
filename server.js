/**
 * Local server: CORS proxy + MySQL import
 * Run: node server.js
 * Open: http://localhost:3000
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const PORT = process.env.PORT || 2090;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

// MySQL connection pool (lazy init)
let pool = null;

function getPool(config) {
  if (!pool || pool._config !== JSON.stringify(config)) {
    if (pool) pool.end().catch(() => {});
    pool = mysql.createPool({
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 5,
      charset: "utf8mb4",
    });
    pool._config = JSON.stringify(config);
  }
  return pool;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function parseDate(d) {
  if (!d) return null;
  const p = d.trim().split(" ")[0].split("/");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : d;
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
  if (g.guestEmail && g.guestEmail.trim()) return g.guestEmail.trim();
  if (g.guestAddress && /^[^@]+@[^@]+\.[^@]+$/.test(g.guestAddress.trim())) return g.guestAddress.trim();
  return null;
}

function mapToOhipRows(r, hotelId, propertyCode) {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const today = new Date().toISOString().slice(0, 10);
  const roomingList = r.reservationRoomingList || [];

  return roomingList.map((rl) => {
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

    return {
      hotel_id: hotelId || null,
      reservation_id: r.reservationID || null,
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
      property_code: propertyCode || null,
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
      booking_status: rl.roomingListStatus || r.reservationStatus || null,
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
  });
}

const server = http.createServer(async (req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  // --- MySQL test connection ---
  if (req.method === "POST" && req.url === "/db/test") {
    try {
      const config = await readBody(req);
      const p = getPool(config);
      const [rows] = await p.query("SELECT 1 AS ok");
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, message: "Connected!" }));
    } catch (e) {
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  // --- MySQL import ---
  if (req.method === "POST" && req.url === "/db/import") {
    try {
      const { dbConfig, reservations, hotelId, propertyCode, mode } = await readBody(req);
      const p = getPool(dbConfig);

      const allRows = reservations.flatMap((r) => mapToOhipRows(r, hotelId, propertyCode));
      let inserted = 0;
      let skipped = 0;
      let updated = 0;

      for (const row of allRows) {
        if (mode === "skip_existing") {
          const [existing] = await p.query("SELECT id FROM ohip_res WHERE reservation_id = ? AND rooming_list_id = ? LIMIT 1", [row.reservation_id, row.rooming_list_id]);
          if (existing.length > 0) { skipped++; continue; }
        }

        if (mode === "upsert") {
          const cols = Object.keys(row);
          const vals = Object.values(row);
          const placeholders = cols.map(() => "?").join(",");
          const updates = cols.filter((c) => !["id", "created_at"].includes(c)).map((c) => `${c} = VALUES(${c})`).join(", ");
          await p.query(
            `INSERT INTO ohip_res (${cols.join(",")}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`,
            vals
          );
          updated++;
        } else {
          const cols = Object.keys(row);
          const vals = Object.values(row);
          const placeholders = cols.map(() => "?").join(",");
          await p.query(`INSERT INTO ohip_res (${cols.join(",")}) VALUES (${placeholders})`, vals);
          inserted++;
        }
      }

      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, total: allRows.length, inserted, skipped, updated }));
    } catch (e) {
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  // --- IDB API proxy ---
  if (req.url.startsWith("/api/")) {
    const targetUrl = "https://openapi.idbtech.io/IDBOpenApi/v2/" + req.url.slice(5);
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;

    https.get(targetUrl, { headers }, (proxyRes) => {
      let body = "";
      proxyRes.on("data", (c) => (body += c));
      proxyRes.on("end", () => {
        res.writeHead(proxyRes.statusCode, { ...cors, "Content-Type": "application/json" });
        res.end(body);
      });
    }).on("error", (e) => {
      res.writeHead(502, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  // --- Static files ---
  const filePath = path.join(__dirname, req.url === "/" ? "index.html" : req.url);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  IDB Exporter running at: http://localhost:${PORT}\n`);
});
