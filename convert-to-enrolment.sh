#!/bin/bash
# ============================================
# Convert IDB reservations → Auto Enrolment CSV
# ============================================

set -e

INPUT="${1}"
if [ -z "$INPUT" ]; then
    echo "Usage: ./convert-to-enrolment.sh <reservations.json>"
    echo "  e.g. ./convert-to-enrolment.sh exports/reservations_20260904.json"
    exit 1
fi

if [ ! -f "$INPUT" ]; then
    echo "File not found: $INPUT"
    exit 1
fi

OUTDIR="./exports"
mkdir -p "$OUTDIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
CSV_OUT="${OUTDIR}/auto_enrolment_${TIMESTAMP}.csv"
JSON_OUT="${OUTDIR}/auto_enrolment_${TIMESTAMP}.json"

python3 << 'PYEOF' "$INPUT" "$CSV_OUT" "$JSON_OUT"
import json, csv, sys, re
from datetime import datetime

input_file = sys.argv[1]
csv_file = sys.argv[2]
json_file = sys.argv[3]

with open(input_file) as f:
    reservations = json.load(f)

def parse_date(d, fmt_in="dd/mm/yyyy"):
    """Parse dd/mm/yyyy or dd/mm/yyyy HH:MM:SS to yyyy-mm-dd"""
    if not d:
        return ""
    try:
        d = d.strip().split(" ")[0]
        parts = d.split("/")
        if len(parts) == 3:
            return f"{parts[2]}-{parts[1]}-{parts[0]}"
    except:
        pass
    return d

def extract_email(booker):
    """Try guestEmail first, then check guestAddress for email pattern"""
    email = booker.get("guestEmail", "").strip()
    if email:
        return email
    addr = booker.get("guestAddress", "").strip()
    if re.match(r"[^@]+@[^@]+\.[^@]+", addr):
        return addr
    return ""

def get_room_info(rooming_list):
    """Extract room info from first rooming list entry"""
    if not rooming_list:
        return {}
    rl = rooming_list[0]
    room = rl.get("roomingListRoom", {})
    room_types = rl.get("roomingListRoomType", [{}])
    rates = rl.get("roomingListRate", [{}])
    rate = rates[0] if rates else {}
    rt = room_types[0] if room_types else {}
    return {
        "room_no": room.get("roomNo", "") if room else "",
        "room_type_code": rt.get("roomTypeCode", ""),
        "room_type_desc": rt.get("roomTypeDescription", ""),
        "rate_code": rate.get("rateCode", ""),
        "rate_amount": rate.get("rateAmount", 0),
        "tax1": rate.get("rateTax1Amount", 0),
        "tax2": rate.get("rateTax2Amount", 0),
        "tax3": rate.get("rateTax3Amount", 0),
        "total_room_rate": rl.get("roomingListTotalRoomRate", 0),
    }

# Build enrolment records
records = []
for r in reservations:
    booker = r.get("reservationBooker", {})
    room = get_room_info(r.get("reservationRoomingList", []))

    total_rate = room.get("total_room_rate", 0)
    rate_with_tax = room.get("rate_amount", 0) + room.get("tax1", 0) + room.get("tax2", 0) + room.get("tax3", 0)

    record = {
        "PROFILE_NO": booker.get("guestID", ""),
        "CONF_NO": r.get("reservationConfirmationNo", ""),
        "ARRIVAL_DATE": parse_date(r.get("reservationArrivalDate", "")),
        "DEPARTURE_DATE": parse_date(r.get("reservationDepartureDate", "")),
        "BOOKING_DATE": parse_date(r.get("reservationBookingDate", "")),
        "GUEST_NAME": f"{booker.get('guestName', '')} {booker.get('guestLastName', '')}".strip(),
        "MEMBERSHIP_NO": "",  # NOT AVAILABLE in API
        "TOTAL_REVENUE": total_rate,  # Only room rate available
        "ROOM_REVENUE": total_rate,
        "FB_REVENUE": "",  # NOT AVAILABLE - needs folio API
        "OTHER_REVENUE": "",  # NOT AVAILABLE - needs folio API
        "RATES": room.get("rate_amount", 0),
        "total_rate": rate_with_tax,
        "REWARD_TYPE": "",  # NOT AVAILABLE
        "PROPERTY_CODE": "",  # HARDCODE per hotel
        "MARKET_CODE": r.get("reservationSegment", ""),
        "RATE_CODE": room.get("rate_code", ""),
        "SOURCE_NAME": r.get("reservationSource", ""),
        "ROOM_NO": room.get("room_no", ""),
        "ROOM_TYPE_RESERV": room.get("room_type_code", ""),
        "EMAIL": extract_email(booker),
        "DESCRIPTION": room.get("room_type_desc", ""),
        "title": booker.get("guestSalutation", ""),
        "FIRSTNAME": booker.get("guestName", "").strip(),
        "LASTNAME": booker.get("guestLastName", "").strip(),
        "STATUS": r.get("reservationStatus", ""),
        "birthday": parse_date(booker.get("guestBirthdate", "")),
    }
    records.append(record)

# Write CSV
fields = list(records[0].keys()) if records else []
with open(csv_file, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    writer.writerows(records)

# Write JSON
with open(json_file, "w") as f:
    json.dump(records, f, indent=2, ensure_ascii=False)

print(f"✓ {len(records)} records exported")
print(f"  CSV:  {csv_file}")
print(f"  JSON: {json_file}")

# Show missing fields warning
print()
print("⚠ Fields NOT available from API (empty in output):")
print("  - MEMBERSHIP_NO: Needs loyalty/membership API")
print("  - FB_REVENUE: Needs folio/billing API")
print("  - OTHER_REVENUE: Needs folio/billing API")
print("  - REWARD_TYPE: Needs loyalty program API")
print("  - PROPERTY_CODE: Set manually per hotel")
PYEOF
