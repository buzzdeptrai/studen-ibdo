const fs = require("fs");
const input = process.argv[2] || "exports/reservations_extracted.json";
const data = JSON.parse(fs.readFileSync(input, "utf8"));

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

function toCsv(rows) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v) => { const s = String(v == null ? "" : v); return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}

// Auto Enrolment
const enrolments = data.map((r) => {
  const b = r.reservationBooker || {};
  const rl0 = (r.reservationRoomingList || [])[0] || {};
  const rt = (rl0.roomingListRoomType || [{}])[0] || {};
  const rate = (rl0.roomingListRate || [{}])[0] || {};
  const room = rl0.roomingListRoom || {};
  const totalRate = rl0.roomingListTotalRoomRate || 0;
  const rateWithTax = (rate.rateAmount || 0) + (rate.rateTax1Amount || 0) + (rate.rateTax2Amount || 0) + (rate.rateTax3Amount || 0);
  return {
    PROFILE_NO: b.guestID || "", CONF_NO: r.reservationConfirmationNo || "",
    ARRIVAL_DATE: parseDate(r.reservationArrivalDate), DEPARTURE_DATE: parseDate(r.reservationDepartureDate),
    BOOKING_DATE: parseDate(r.reservationBookingDate),
    GUEST_NAME: `${b.guestName || ""} ${b.guestLastName || ""}`.trim(),
    MEMBERSHIP_NO: "", TOTAL_REVENUE: totalRate, ROOM_REVENUE: totalRate,
    FB_REVENUE: "", OTHER_REVENUE: "",
    RATES: rate.rateAmount || 0, total_rate: rateWithTax,
    REWARD_TYPE: "", PROPERTY_CODE: "",
    MARKET_CODE: r.reservationSegment || "", RATE_CODE: rate.rateCode || "",
    SOURCE_NAME: r.reservationSource || "", ROOM_NO: room.roomNo || "",
    ROOM_TYPE_RESERV: rt.roomTypeCode || "", EMAIL: extractEmail(b),
    DESCRIPTION: rt.roomTypeDescription || "", title: b.guestSalutation || "",
    FIRSTNAME: (b.guestName || "").trim(), LASTNAME: (b.guestLastName || "").trim(),
    STATUS: r.reservationStatus || "", birthday: parseDate(b.guestBirthdate),
  };
});

// Arrival List
const arrivals = data.flatMap((r) => {
  return (r.reservationRoomingList || []).map((rl0) => {
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
      CONF_NO: r.reservationConfirmationNo || "", STATUS: r.reservationStatus || "",
      GUEST_NAME: `${guest.guestName || ""} ${guest.guestLastName || ""}`.trim(),
      title: guest.guestSalutation || "",
      FIRSTNAME: (guest.guestName || "").trim(), LASTNAME: (guest.guestLastName || "").trim(),
      NATIONALITY: guest.guestNationality || "", VIP: guest.guestIsVIP || "",
      MOBILE: guest.guestMobileNo || "", EMAIL: extractEmail(guest),
      ARRIVAL_DATE: parseDate(rl0.roomingListArrivalDate), DEPARTURE_DATE: parseDate(rl0.roomingListDepartureDate),
      ETA: rl0.roomingListETA || "", NIGHTS: nights,
      ROOM_NO: room.roomNo || "", ROOM_TYPE: rt.roomTypeCode || "",
      ROOM_TYPE_DESC: rt.roomTypeDescription || "",
      ADULTS: rl0.roomingListNoOfAdult || 0, CHILDREN: rl0.roomingListNoOfChild || 0,
      RATE_CODE: rate.rateCode || "", RATE_AMOUNT: rate.rateAmount || 0,
      TOTAL_RATE: rl0.roomingListTotalRoomRate || 0,
      SOURCE: r.reservationSource || "", SEGMENT: r.reservationSegment || "",
      GROUP_NAME: r.reservationGroupName || "", IS_GROUP: r.reservationIsGroup || "",
    };
  });
}).sort((a, b) => (a.ARRIVAL_DATE || "").localeCompare(b.ARRIVAL_DATE || ""));

// Write files
fs.writeFileSync("exports/auto_enrolment.json", JSON.stringify(enrolments, null, 2));
fs.writeFileSync("exports/auto_enrolment.csv", toCsv(enrolments));
fs.writeFileSync("exports/arrival_list.json", JSON.stringify(arrivals, null, 2));
fs.writeFileSync("exports/arrival_list.csv", toCsv(arrivals));

console.log(`Enrolment: ${enrolments.length} records -> exports/auto_enrolment.json + .csv`);
console.log(`Arrival:   ${arrivals.length} records -> exports/arrival_list.json + .csv`);
