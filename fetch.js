/**
 * IDB Reservation Exporter MVP
 * Run: node fetch.js
 * No dependencies needed - uses built-in Node.js modules
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, def) =>
  new Promise((res) =>
    rl.question(`${q}${def ? ` [${def}]` : ""}: `, (a) => res(a.trim() || def || ""))
  );

const API_BASE = "https://openapi.idbtech.io/IDBOpenApi/v2/reservations";

function httpGet(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        } else {
          try { resolve(JSON.parse(body)); } catch { resolve(body); }
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function parseDate(d) {
  if (!d) return "";
  const p = d.trim().split(" ")[0].split("/");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : d;
}

function extractEmail(g) {
  if (g.guestEmail && g.guestEmail.trim()) return g.guestEmail.trim();
  if (g.guestAddress && /^[^@]+@[^@]+\.[^@]+$/.test(g.guestAddress.trim())) return g.guestAddress.trim();
  return "";
}

function toEnrolment(r) {
  const b = r.reservationBooker || {};
  const rl0 = (r.reservationRoomingList || [])[0] || {};
  const rt = (rl0.roomingListRoomType || [{}])[0] || {};
  const rate = (rl0.roomingListRate || [{}])[0] || {};
  const room = rl0.roomingListRoom || {};
  const totalRate = rl0.roomingListTotalRoomRate || 0;
  const rateWithTax = (rate.rateAmount || 0) + (rate.rateTax1Amount || 0) + (rate.rateTax2Amount || 0) + (rate.rateTax3Amount || 0);

  return {
    PROFILE_NO: b.guestID || "",
    CONF_NO: r.reservationConfirmationNo || "",
    ARRIVAL_DATE: parseDate(r.reservationArrivalDate),
    DEPARTURE_DATE: parseDate(r.reservationDepartureDate),
    BOOKING_DATE: parseDate(r.reservationBookingDate),
    GUEST_NAME: `${b.guestName || ""} ${b.guestLastName || ""}`.trim(),
    MEMBERSHIP_NO: "",
    TOTAL_REVENUE: totalRate,
    ROOM_REVENUE: totalRate,
    FB_REVENUE: "",
    OTHER_REVENUE: "",
    RATES: rate.rateAmount || 0,
    total_rate: rateWithTax,
    REWARD_TYPE: "",
    PROPERTY_CODE: "",
    MARKET_CODE: r.reservationSegment || "",
    RATE_CODE: rate.rateCode || "",
    SOURCE_NAME: r.reservationSource || "",
    ROOM_NO: room.roomNo || "",
    ROOM_TYPE_RESERV: rt.roomTypeCode || "",
    EMAIL: extractEmail(b),
    DESCRIPTION: rt.roomTypeDescription || "",
    title: b.guestSalutation || "",
    FIRSTNAME: (b.guestName || "").trim(),
    LASTNAME: (b.guestLastName || "").trim(),
    STATUS: r.reservationStatus || "",
    birthday: parseDate(b.guestBirthdate),
  };
}

function toArrival(r) {
  const rooming = r.reservationRoomingList || [];
  return rooming.map((rl0) => {
    const guest = (rl0.roomingListGuest || [])[0] || r.reservationBooker || {};
    const rt = (rl0.roomingListRoomType || [{}])[0] || {};
    const rate = (rl0.roomingListRate || [{}])[0] || {};
    const room = rl0.roomingListRoom || {};
    let nights = 0;
    try {
      const [d1, m1, y1] = rl0.roomingListArrivalDate.split("/");
      const [d2, m2, y2] = rl0.roomingListDepartureDate.split("/");
      nights = Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
    } catch {}

    return {
      CONF_NO: r.reservationConfirmationNo || "",
      STATUS: r.reservationStatus || "",
      GUEST_NAME: `${guest.guestName || ""} ${guest.guestLastName || ""}`.trim(),
      title: guest.guestSalutation || "",
      FIRSTNAME: (guest.guestName || "").trim(),
      LASTNAME: (guest.guestLastName || "").trim(),
      NATIONALITY: guest.guestNationality || "",
      VIP: guest.guestIsVIP || "",
      MOBILE: guest.guestMobileNo || "",
      EMAIL: extractEmail(guest),
      ARRIVAL_DATE: parseDate(rl0.roomingListArrivalDate),
      DEPARTURE_DATE: parseDate(rl0.roomingListDepartureDate),
      ETA: rl0.roomingListETA || "",
      NIGHTS: nights,
      ROOM_NO: room.roomNo || "",
      ROOM_TYPE: rt.roomTypeCode || "",
      ROOM_TYPE_DESC: rt.roomTypeDescription || "",
      ADULTS: rl0.roomingListNoOfAdult || 0,
      CHILDREN: rl0.roomingListNoOfChild || 0,
      RATE_CODE: rate.rateCode || "",
      RATE_AMOUNT: rate.rateAmount || 0,
      TOTAL_RATE: rl0.roomingListTotalRoomRate || 0,
      SOURCE: r.reservationSource || "",
      SEGMENT: r.reservationSegment || "",
      GROUP_NAME: r.reservationGroupName || "",
      IS_GROUP: r.reservationIsGroup || "",
      SPECIAL_REQUEST: r.reservationSpecialRequest || "",
    };
  });
}

function toCsv(rows) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const escape = (v) => {
    const s = String(v == null ? "" : v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => escape(r[k])).join(","))].join("\n");
}

async function main() {
  console.log("============================================");
  console.log("  IDB Reservation Exporter MVP (Node.js)");
  console.log("============================================\n");

  const token = process.env.IDB_TOKEN || (await ask("Bearer Token", ""));
  if (!token) { console.log("Token is required!"); process.exit(1); }

  const arrFrom = await ask("Arrival From (dd/mm/yyyy)", "01/01/2026");
  const arrTo = await ask("Arrival To   (dd/mm/yyyy)", "01/06/2026");
  console.log("\nStatus: B=Booked, IC=Checked-In, IP=In-House, OP=Checked-Out");
  const status = await ask("Status (comma-separated)", "B,IC,IP,OP");
  const pageSize = parseInt(await ask("Page size", "50")) || 50;
  rl.close();

  const outDir = path.join(__dirname, "exports");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);

  console.log(`\nFetching: ${arrFrom} → ${arrTo} | Status: ${status} ...\n`);

  let all = [];
  let page = 1;

  while (true) {
    const url = `${API_BASE}?arrivalFrom=${arrFrom}&arrivalTo=${arrTo}&reservationStatus=${encodeURIComponent(status)}&pageNo=${page}&size=${pageSize}`;
    try {
      const data = await httpGet(url, token);
      // API returns: [{ res_msg: [...], totalPage, currentPageNo }]
      let root = data;
      if (Array.isArray(root) && root.length === 1 && root[0].res_msg) root = root[0];
      let list = [];
      let totalPage = 0;
      if (Array.isArray(root) && root.length && root[0].reservationID) {
        list = root;
      } else if (root.res_msg && Array.isArray(root.res_msg)) {
        list = root.res_msg;
        totalPage = root.totalPage || 0;
      } else if (root.data && Array.isArray(root.data)) {
        list = root.data;
      } else {
        list = [];
      }

      if (!list.length || (list.length === 1 && !list[0].reservationID)) {
        if (page === 1) {
          fs.writeFileSync(path.join(outDir, `raw_${ts}.json`), JSON.stringify(data, null, 2));
          console.log("No records. Raw response saved to exports/raw_" + ts + ".json");
        }
        break;
      }

      all.push(...list);
      console.log(`  Page ${page}/${totalPage || "?"}: ${list.length} records`);
      if (list.length < pageSize || (totalPage && page >= totalPage)) break;
      page++;
    } catch (e) {
      console.error(`Error: ${e.message}`);
      if (page === 1) process.exit(1);
      break;
    }
  }

  if (!all.length) { console.log("No data to export."); process.exit(0); }

  // Save raw
  const rawFile = path.join(outDir, `reservations_raw_${ts}.json`);
  fs.writeFileSync(rawFile, JSON.stringify(all, null, 2));

  // Convert to enrolment
  const enrolments = all.map(toEnrolment);
  fs.writeFileSync(path.join(outDir, `auto_enrolment_${ts}.json`), JSON.stringify(enrolments, null, 2));
  fs.writeFileSync(path.join(outDir, `auto_enrolment_${ts}.csv`), toCsv(enrolments));

  // Convert to arrival list
  const arrivals = all.flatMap(toArrival);
  arrivals.sort((a, b) => a.ARRIVAL_DATE.localeCompare(b.ARRIVAL_DATE));
  fs.writeFileSync(path.join(outDir, `arrival_list_${ts}.json`), JSON.stringify(arrivals, null, 2));
  fs.writeFileSync(path.join(outDir, `arrival_list_${ts}.csv`), toCsv(arrivals));

  // Summary
  const statuses = {};
  all.forEach((r) => { const s = r.reservationStatus; statuses[s] = (statuses[s] || 0) + 1; });

  console.log("\n============================================");
  console.log(`  Total: ${all.length} reservations`);
  console.log(`  Status: ${JSON.stringify(statuses)}`);
  console.log("============================================");
  console.log(`\n  Raw:        exports/reservations_raw_${ts}.json`);
  console.log(`  Enrolment:  exports/auto_enrolment_${ts}.csv + .json`);
  console.log(`  Arrivals:   exports/arrival_list_${ts}.csv + .json`);
  console.log("\n  Missing fields (needs other API): MEMBERSHIP_NO, FB_REVENUE, OTHER_REVENUE, REWARD_TYPE, PROPERTY_CODE");
}

main().catch((e) => { console.error(e); process.exit(1); });
