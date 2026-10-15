#!/bin/bash
# ============================================
# Convert IDB reservations → Arrival List CSV
# ============================================

set -e

INPUT="${1}"
if [ -z "$INPUT" ]; then
    echo "Usage: ./convert-to-arrival.sh <reservations.json>"
    echo "  e.g. ./convert-to-arrival.sh exports/reservations_20260904.json"
    exit 1
fi

if [ ! -f "$INPUT" ]; then
    echo "File not found: $INPUT"
    exit 1
fi

OUTDIR="./exports"
mkdir -p "$OUTDIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
CSV_OUT="${OUTDIR}/arrival_list_${TIMESTAMP}.csv"
JSON_OUT="${OUTDIR}/arrival_list_${TIMESTAMP}.json"

python3 << 'PYEOF' "$INPUT" "$CSV_OUT" "$JSON_OUT"
import json, csv, sys, re

input_file = sys.argv[1]
csv_file = sys.argv[2]
json_file = sys.argv[3]

with open(input_file) as f:
    reservations = json.load(f)

def parse_date(d):
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
    email = booker.get("guestEmail", "").strip()
    if email:
        return email
    addr = booker.get("guestAddress", "").strip()
    if re.match(r"[^@]+@[^@]+\.[^@]+", addr):
        return addr
    return ""

records = []
for r in reservations:
    booker = r.get("reservationBooker", {})
    rooming_list = r.get("reservationRoomingList", [])

    for rl in rooming_list:
        room = rl.get("roomingListRoom", {}) or {}
        room_types = rl.get("roomingListRoomType", [{}])
        rates = rl.get("roomingListRate", [{}])
        rate = rates[0] if rates else {}
        rt = room_types[0] if room_types else {}
        guests = rl.get("roomingListGuest", [])
        guest = guests[0] if guests else booker

        record = {
            "CONF_NO": r.get("reservationConfirmationNo", ""),
            "STATUS": r.get("reservationStatus", ""),
            "GUEST_NAME": f"{guest.get('guestName', '')} {guest.get('guestLastName', '')}".strip(),
            "title": guest.get("guestSalutation", ""),
            "FIRSTNAME": guest.get("guestName", "").strip(),
            "LASTNAME": guest.get("guestLastName", "").strip(),
            "NATIONALITY": guest.get("guestNationality", ""),
            "VIP": guest.get("guestIsVIP", ""),
            "VIP_TYPE": guest.get("guestVIPType", ""),
            "MOBILE": guest.get("guestMobileNo", ""),
            "EMAIL": extract_email(guest),
            "ARRIVAL_DATE": parse_date(rl.get("roomingListArrivalDate", "")),
            "DEPARTURE_DATE": parse_date(rl.get("roomingListDepartureDate", "")),
            "ETA": rl.get("roomingListETA", ""),
            "NIGHTS": 0,
            "ROOM_NO": room.get("roomNo", ""),
            "ROOM_TYPE": rt.get("roomTypeCode", ""),
            "ROOM_TYPE_DESC": rt.get("roomTypeDescription", ""),
            "ROOM_CATEGORY": room.get("roomCategoryDescription", ""),
            "FLOOR": room.get("roomFloor", ""),
            "ADULTS": rl.get("roomingListNoOfAdult", 0),
            "CHILDREN": rl.get("roomingListNoOfChild", 0),
            "INFANTS": rl.get("roomingListNoOfInfant", 0),
            "RATE_CODE": rate.get("rateCode", ""),
            "RATE_DESC": rate.get("rateCodeDescription", ""),
            "RATE_AMOUNT": rate.get("rateAmount", 0),
            "TOTAL_RATE": rl.get("roomingListTotalRoomRate", 0),
            "SOURCE": r.get("reservationSource", ""),
            "SEGMENT": r.get("reservationSegment", ""),
            "GROUP_NAME": r.get("reservationGroupName", ""),
            "IS_GROUP": r.get("reservationIsGroup", ""),
            "IS_WALKIN": r.get("reservationIsWalkIn", ""),
            "SPECIAL_REQUEST": r.get("reservationSpecialRequest", ""),
            "REMARKS": r.get("reservationRemarks", ""),
            "ROOM_STATUS": room.get("roomStatus", ""),
            "HK_STATUS": room.get("roomHousekeepingStatus", ""),
        }

        # Calculate nights
        try:
            from datetime import datetime
            arr = datetime.strptime(rl.get("roomingListArrivalDate", ""), "%d/%m/%Y")
            dep = datetime.strptime(rl.get("roomingListDepartureDate", ""), "%d/%m/%Y")
            record["NIGHTS"] = (dep - arr).days
        except:
            pass

        records.append(record)

# Sort by arrival date
records.sort(key=lambda x: x.get("ARRIVAL_DATE", ""))

# Write CSV
fields = list(records[0].keys()) if records else []
with open(csv_file, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    writer.writerows(records)

# Write JSON
with open(json_file, "w") as f:
    json.dump(records, f, indent=2, ensure_ascii=False)

print(f"✓ {len(records)} arrival entries exported")
print(f"  CSV:  {csv_file}")
print(f"  JSON: {json_file}")

# Stats
statuses = {}
for rec in records:
    s = rec["STATUS"]
    statuses[s] = statuses.get(s, 0) + 1
print(f"\n  By status: {statuses}")
PYEOF
