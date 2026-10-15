const fs = require("fs");
const data = JSON.parse(fs.readFileSync("exports/reservations_extracted.json", "utf8"));

// Pick a record with rich data
let best = data[0];
for (const r of data) {
  const b = r.reservationBooker || {};
  if (b.guestEmail || b.guestMobileNo) { best = r; break; }
}

const r = best;
const b = r.reservationBooker || {};
const rl0 = (r.reservationRoomingList || [])[0] || {};
const guest = (rl0.roomingListGuest || [])[0] || {};
const room = rl0.roomingListRoom || {};
const rate = (rl0.roomingListRate || [{}])[0] || {};
const roomCat = room.roomCategory || {};

console.log("=== SAMPLE RESERVATION:", r.reservationConfirmationNo, "===\n");

// Define what IS mapped to ohip_res
const mapped = {
  reservation_id: r.reservationID,
  profile_no: b.guestID,
  guestno: r.reservationConfirmationNo,
  arr_date: r.reservationArrivalDate,
  dep_date: r.reservationDepartureDate,
  reservation_date: r.reservationBookingDate,
  guest_name: (b.guestName || "") + " " + (b.guestLastName || ""),
  ttl_rev: rl0.roomingListTotalRoomRate,
  rm_rev: rl0.roomingListTotalRoomRate,
  rm_rate: rate.rateAmount,
  total_rate: "rateAmount + taxes",
  market_code: r.reservationSegment,
  race_code: b.guestRace,
  source_name: r.reservationSource,
  room_no: room.roomNo,
  room_type: (rl0.roomingListRoomType || [{}])[0].roomTypeCode,
  email: b.guestEmail || b.guestAddress,
  remark: r.reservationRemarks,
  title: b.guestSalutation,
  firstname: b.guestName,
  lastname: b.guestLastName,
  booking_status: r.reservationStatus,
  country: r.reservationContactCountry,
  mobile_number: b.guestMobileNo,
  nationality: b.guestNationality,
  gender: b.guestSex,
  address: b.guestAddress,
  home_number: b.guestTelephoneNo,
  postcode: b.guestPostcode,
  city: b.guestCity,
  birthday: b.guestBirthdate,
};

console.log("MAPPED (ohip_res <- IDB API):");
for (const [col, val] of Object.entries(mapped)) {
  console.log(`  ${col.padEnd(25)} = ${val || "(empty)"}`);
}

// All API fields NOT mapped
console.log("\n=== API FIELDS NOT MAPPED TO ohip_res ===\n");

const unmapped = [];

// Reservation level
const resSkip = ["reservationBooker", "reservationRoomingList"];
for (const [k, v] of Object.entries(r)) {
  if (resSkip.includes(k)) continue;
  const inMapped = Object.values(mapped).some((m) => m === v);
  if (!inMapped && k !== "reservationID") {
    unmapped.push({ source: k, value: v, level: "reservation" });
  }
}

// Booker level
const bookerMapped = ["guestID", "guestName", "guestLastName", "guestEmail", "guestAddress",
  "guestMobileNo", "guestTelephoneNo", "guestSalutation", "guestSex", "guestNationality",
  "guestRace", "guestPostcode", "guestCity", "guestBirthdate", "guestCountry", "guestIsVIP"];
for (const [k, v] of Object.entries(b)) {
  if (!bookerMapped.includes(k) && v && v !== "" && v !== "N") {
    unmapped.push({ source: "booker." + k, value: v, level: "booker" });
  }
}

// Rate level
const rateMapped = ["rateAmount", "rateTax1Amount", "rateTax2Amount", "rateTax3Amount"];
for (const [k, v] of Object.entries(rate)) {
  if (!rateMapped.includes(k) && typeof v !== "object" && v && v !== "" && v !== "Y") {
    unmapped.push({ source: "rate." + k, value: v, level: "rate" });
  }
}

// Room level
for (const [k, v] of Object.entries(room)) {
  if (k !== "roomNo" && typeof v !== "object" && v && v !== "" && v !== "Y") {
    unmapped.push({ source: "room." + k, value: v, level: "room" });
  }
}

for (const item of unmapped) {
  const val = typeof item.value === "string" ? item.value : JSON.stringify(item.value);
  console.log(`  ${item.source.padEnd(40)} = ${val}`);
}

// ohip_res columns that are ALWAYS null
console.log("\n=== ohip_res COLUMNS ALWAYS NULL (0/50) ===\n");
const alwaysNull = [
  "hotel_id", "membership_no", "fb_rev", "other_rev", "point_type",
  "property_code", "minus_marked", "membership_no_original",
  "flag_revenue", "time_revenue", "state", "lang", "cardname",
  "passport", "idcard"
];
for (const col of alwaysNull) {
  console.log(`  ${col.padEnd(25)} <- NO source in IDB API`);
}

// Check potential issues
console.log("\n=== POTENTIAL ISSUES ===\n");

// 1. rate_code not mapped
console.log("1. rate_code (rateCode) = '" + rate.rateCode + "' -> NOT in ohip_res table (no column for it)");

// 2. guestVIPType
console.log("2. guestVIPType = '" + (b.guestVIPType || "") + "' -> could map to point_type?");

// 3. reservationContactNo1 vs mobile_number
console.log("3. reservationContactNo1 = '" + (r.reservationContactNo1 || "") + "' -> not mapped (mobile_number uses booker.guestMobileNo)");

// 4. reservationContactEmail
console.log("4. reservationContactEmail = '" + (r.reservationContactEmail || "") + "' -> not mapped (email uses booker fields)");

// 5. guestFaxNo
console.log("5. guestFaxNo = '" + (b.guestFaxNo || "") + "' -> no column in ohip_res");

// 6. guestMaritalStatus
console.log("6. guestMaritalStatus = '" + (b.guestMaritalStatus || "") + "' -> no column in ohip_res");

// 7. Check email in address field
let emailInAddr = 0;
let emptyEmail = 0;
for (const rec of data) {
  const bk = rec.reservationBooker || {};
  if (!bk.guestEmail && /^[^@]+@[^@]+\.[^@]+$/.test(bk.guestAddress || "")) emailInAddr++;
  if (!bk.guestEmail && !/^[^@]+@[^@]+\.[^@]+$/.test(bk.guestAddress || "")) emptyEmail++;
}
console.log(`7. Email detection: ${emailInAddr} found in guestAddress, ${emptyEmail} truly empty`);

// 8. birthday always empty?
let hasBday = 0;
for (const rec of data) {
  if ((rec.reservationBooker || {}).guestBirthdate) hasBday++;
}
console.log(`8. birthday: ${hasBday}/50 have data`);

// 9. Room assigned only for checked-in
let hasRoom = 0;
let statusWithRoom = {};
for (const rec of data) {
  const rl = (rec.reservationRoomingList || [])[0] || {};
  if (rl.roomingListRoom && rl.roomingListRoom.roomNo) {
    hasRoom++;
    const s = rec.reservationStatus;
    statusWithRoom[s] = (statusWithRoom[s] || 0) + 1;
  }
}
console.log(`9. room_no: ${hasRoom}/50 have room assigned. By status:`, JSON.stringify(statusWithRoom));
