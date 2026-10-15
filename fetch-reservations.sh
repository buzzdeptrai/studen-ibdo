#!/bin/bash
# ============================================
# IDB Open API - Reservation Fetcher MVP
# Export reservations to JSON sample files
# ============================================

set -e

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

API_BASE="https://openapi.idbtech.io/IDBOpenApi/v2/reservations"

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  IDB Reservation Exporter MVP${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# --- Bearer Token ---
if [ -n "$IDB_TOKEN" ]; then
    TOKEN="$IDB_TOKEN"
    echo -e "${GREEN}✓ Using token from IDB_TOKEN env${NC}"
else
    read -p "Bearer Token: " TOKEN
fi

if [ -z "$TOKEN" ]; then
    echo -e "${RED}✗ Token is required${NC}"
    exit 1
fi

# --- Arrival From ---
read -p "Arrival From (dd/mm/yyyy) [01/01/2026]: " ARRIVAL_FROM
ARRIVAL_FROM=${ARRIVAL_FROM:-"01/01/2026"}

# --- Arrival To ---
read -p "Arrival To   (dd/mm/yyyy) [01/06/2026]: " ARRIVAL_TO
ARRIVAL_TO=${ARRIVAL_TO:-"01/06/2026"}

# --- Status ---
echo ""
echo "Status options: B=Booked, IC=Checked-In, IP=In-House, OP=Checked-Out"
read -p "Status (comma-separated) [B,IC,IP,OP]: " STATUS
STATUS=${STATUS:-"B,IC,IP,OP"}

# --- Page Size ---
read -p "Page size [50]: " PAGE_SIZE
PAGE_SIZE=${PAGE_SIZE:-50}

# --- Output dir ---
OUTDIR="./exports"
mkdir -p "$OUTDIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTFILE="${OUTDIR}/reservations_${TIMESTAMP}.json"

# URL encode status
STATUS_ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${STATUS}'))")

echo ""
echo -e "${YELLOW}Fetching reservations...${NC}"
echo -e "  From:   ${ARRIVAL_FROM}"
echo -e "  To:     ${ARRIVAL_TO}"
echo -e "  Status: ${STATUS}"
echo -e "  Size:   ${PAGE_SIZE}"
echo ""

# --- Fetch all pages ---
PAGE=1
ALL_RECORDS="[]"
TOTAL_FETCHED=0

while true; do
    URL="${API_BASE}?arrivalFrom=${ARRIVAL_FROM}&arrivalTo=${ARRIVAL_TO}&reservationStatus=${STATUS_ENCODED}&pageNo=${PAGE}&size=${PAGE_SIZE}"

    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        "${URL}")

    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" != "200" ]; then
        echo -e "${RED}✗ API Error (HTTP ${HTTP_CODE})${NC}"
        echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
        exit 1
    fi

    # Extract records count from response
    RECORDS=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
records = data if isinstance(data, list) else data.get('data', data.get('content', data.get('results', data.get('reservations', []))))
if isinstance(records, list):
    print(json.dumps(records))
    print(len(records), file=sys.stderr)
else:
    # Whole response might be the wrapper
    print(json.dumps([data]))
    print(1, file=sys.stderr)
" 2>/tmp/idb_count.txt)

    COUNT=$(cat /tmp/idb_count.txt)

    if [ -z "$RECORDS" ] || [ "$RECORDS" = "[]" ] || [ "$COUNT" = "0" ]; then
        if [ $PAGE -eq 1 ]; then
            echo -e "${RED}✗ No records found${NC}"
            # Save raw response for debugging
            echo "$BODY" | python3 -m json.tool > "${OUTDIR}/raw_response_${TIMESTAMP}.json" 2>/dev/null
            echo -e "  Raw response saved to ${OUTDIR}/raw_response_${TIMESTAMP}.json"
        fi
        break
    fi

    # Merge records
    ALL_RECORDS=$(python3 -c "
import json
existing = json.loads('${ALL_RECORDS}') if '${ALL_RECORDS}' != '[]' else []
# Read from stdin to avoid shell escaping issues
import sys
new = json.loads(sys.stdin.read())
existing.extend(new)
print(json.dumps(existing))
" <<< "$RECORDS")

    TOTAL_FETCHED=$((TOTAL_FETCHED + COUNT))
    echo -e "  Page ${PAGE}: ${COUNT} records"

    # If less than page size, we're done
    if [ "$COUNT" -lt "$PAGE_SIZE" ]; then
        break
    fi

    PAGE=$((PAGE + 1))
done

# --- Save output ---
echo "$ALL_RECORDS" | python3 -m json.tool > "$OUTFILE"

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}✓ Exported ${TOTAL_FETCHED} reservations${NC}"
echo -e "${GREEN}  File: ${OUTFILE}${NC}"
echo -e "${GREEN}============================================${NC}"

# --- Quick summary ---
python3 -c "
import json

with open('${OUTFILE}') as f:
    data = json.load(f)

statuses = {}
sources = {}
segments = {}

for r in data:
    s = r.get('reservationStatus', '?')
    statuses[s] = statuses.get(s, 0) + 1
    src = r.get('reservationSource', '?')
    sources[src] = sources.get(src, 0) + 1
    seg = r.get('reservationSegment', '?')
    segments[seg] = segments.get(seg, 0) + 1

print()
print('Summary:')
print(f'  Total: {len(data)} reservations')
print(f'  Status:  {dict(sorted(statuses.items()))}')
print(f'  Source:  {dict(sorted(sources.items()))}')
print(f'  Segment: {dict(sorted(segments.items()))}')
"

echo ""
echo -e "${CYAN}Next steps:${NC}"
echo -e "  1. Review: cat ${OUTFILE} | python3 -m json.tool | less"
echo -e "  2. Convert: ./convert-to-enrolment.sh ${OUTFILE}"
echo -e "  3. Convert: ./convert-to-arrival.sh ${OUTFILE}"
