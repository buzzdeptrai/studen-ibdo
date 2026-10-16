# IBDO-PMS — IDB Open API to PMS/CRM Importer

## Project Purpose
Fetch reservations from IDB Open API → transform → import into `ohip_res` MySQL table for PMS/CRM (auto enrolment, arrival list).

## Architecture
- `server.js` — Node.js local server: CORS proxy (`/api/*`) + MySQL endpoints (`/db/test`, `/db/import`)
- `index.html` — UI: fetch API, preview (Raw/Enrolment/Arrival tabs), export CSV/JSON, import to MySQL
- `import-db.js` — CLI script: read JSON → insert into MySQL
- `fetch.js` — CLI script: interactive fetch from API → export files
- `convert.js` — CLI script: convert raw JSON → enrolment + arrival CSV/JSON

## IDB API Response Format
```
GET /IDBOpenApi/v2/reservations?arrivalFrom=&arrivalTo=&reservationStatus=&pageNo=&size=
→ [{ res_msg: [...reservations], totalPage, currentPageNo }]
```
Response is wrapped: `Array[1] > .res_msg > Array[reservations]`

## Data Mapping: IDB API → ohip_res

### Source: `roomingListGuest` (NOT reservationBooker)
Guest info comes from `reservationRoomingList[].roomingListGuest[0]` — the actual guest staying, not the person who booked.

### Field Mapping
| ohip_res | IDB API source |
|---|---|
| reservation_id | reservationID |
| profile_no | roomingListGuest[0].guestID |
| guestno | reservationConfirmationNo |
| arr_date | roomingListArrivalDate |
| dep_date | roomingListDepartureDate |
| reservation_date | reservationBookingDate |
| guest_name | guestName + guestLastName |
| firstname | guestName |
| lastname | guestLastName |
| title | guestSalutation |
| email | guestEmail, fallback guestAddress if email pattern |
| mobile_number | guestMobileNo, fallback reservationContactNo1 |
| home_number | guestTelephoneNo |
| gender | guestSex |
| nationality | guestNationality |
| race_code | guestRace |
| birthday | guestBirthdate |
| address | guestAddress (NULL if it contains email) |
| postcode | guestPostcode |
| city | guestCity |
| country | reservationContactCountry, fallback guestCountry |
| rm_rate | roomingListRate[0].rateAmount (per night, excl tax) |
| total_rate | rateAmount + rateTax1 + rateTax2 + rateTax3 (per night, incl tax) |
| market_code | reservationSegment |
| source_name | reservationSource |
| room_no | roomingListRoom.roomNo (only when assigned/checked-in) |
| room_type | roomingListRoomType[0].roomTypeCode |
| booking_status | roomingListStatus (per-room; fallback reservationStatus) |
| remark | reservationRemarks |
| file_process | "IDB_API" (hardcoded) |

### Fields intentionally left NULL (no source in API)
point_type, membership_no, membership_no_original, property_code, hotel_id, flag_revenue, time_revenue, state, lang, cardname, passport, idcard, minus_marked

### Fields available in API but NOT mapped to ohip_res (no column)
- rateCode (e.g. "BST-RM")
- guestVIPType (e.g. "RP")
- reservationGroupName
- reservationIsGroup
- reservationOTANo
- reservationContactEmail
- reservationArrivalTime / DepartureTime
- roomingListRoom.roomFloor, roomCategory, roomStatus, roomHousekeepingStatus

## ⚠️ Revenue Mapping (QUAN TRỌNG — có thể đổi logic/flow sau)

> Logic tính revenue này **dễ thay đổi** theo yêu cầu CRM (points, arrival list, auto register). Khi sửa phải cập nhật ĐỒNG BỘ ở cả `server.js` (`mapToOhipRows`) và `import-db.js`.

### Nguồn: `reservationRoomingList[].roomingListRevenue` (API format MỚI, cập nhật 2026-10)
Mỗi khoản revenue là **object `{ net, tax }`**; riêng `total` có thêm `gross`:
```json
"roomingListRevenue": {
  "roomRevenue":    { "net": 87.72, "tax": 12.28 },
  "fnbRevenue":     { "net": 0, "tax": 0 },
  "otherRevenue":   { "net": 0, "tax": 0 },
  "statutory":      { "net": 0, "tax": 0 },
  "ioRevenue":      { "net": 0, "tax": 0 },
  "nonHotelRevenue":{ "net": 0, "tax": 0 },
  "total":          { "net": 87.72, "tax": 12.28, "gross": 100 }
}
```

### Quy tắc (CHỐT 2026-10-16) — dùng **incl tax** (gross = net + tax)
| ohip_res | Công thức |
|---|---|
| `rm_rev` | `roomRevenue` gross (net+tax) |
| `fb_rev` | `fnbRevenue` gross (default 0) |
| `other_rev` | `otherRevenue` gross (default 0) |
| `ttl_rev` | `total.gross` nếu có & ≥ `manual_total`, ngược lại = `manual_total` |

- **`manual_total` = Σ gross của MỌI khoản ≠ `total`** (gồm cả `statutory`, `ioRevenue`, `nonHotelRevenue` — những khoản KHÔNG có cột riêng). KHÔNG phải chỉ `rm_rev+fb_rev+other_rev`.
- Helper `revGross(x)`: có `.gross` → dùng gross; ngược lại `net + tax`.
- **Fallback** (API cũ chưa có `roomingListRevenue`): `rm_rev = (rateAmount + tax1+2+3) × số đêm`; `ttl_rev = rm_rev`.

### Lưu ý
- `fb_rev`/`other_rev` để `0` (không NULL) để service CRM cộng points không lỗi.
- `total.gross` = tổng TẤT CẢ khoản → `ttl_rev` luôn ≥ tổng 3 cột rm/fb/other.
- File sample `exports/reservations_raw.json` bản cũ (Sep 7) CHƯA có revenue → muốn test đường chính phải fetch data mới.

## Decisions Made
- **1 row per room** (DECIDED 2026-09-10): Each roomingList entry = 1 row in ohip_res. Skip check uses `reservation_id + rooming_list_id`. Added `rooming_list_id` column to ohip_res. 50 reservations → 144 rows.
- **Revenue incl tax** (DECIDED 2026-10-16): xem section "Revenue Mapping" ở trên.
- **booking_status theo cấp phòng** (DECIDED 2026-10-16): dùng `roomingListStatus` (per-room), fallback `reservationStatus`. Vì reservation=B/IC nhưng phòng có thể =N (huỷ) hoặc =C (đã check-out). Rate ≠ Revenue: `rm_rate`/`total_rate` = rate plan (giá/đêm incl tax, để NULL khi rateAmount=0, KHÔNG backfill từ revenue); tiền thực nằm ở `rm_rev`/`ttl_rev`.

## Data Structure
- **1 reservation → nhiều dòng** (1 dòng per roomingList entry/room)
- 89 reservations → ~213 rows (trung bình ~2.4 rooms/reservation)

## Status Codes
| Code | Meaning |
|---|---|
| B | Booking (đặt phòng, chưa đến) |
| IP | In House Pending (đã nhận phòng, chưa hoàn tất thủ tục) |
| IC | In House Complete (đang ở, thủ tục hoàn tất) |
| OP | Check Out Pending (chờ trả phòng) |
| C | Checked Out (đã trả phòng, tất cả booking items) |
| N | Booking Cancel (hủy đặt phòng) |
| NS | No Show (đặt nhưng không đến) |

**Flow:** B → IP → IC → OP → C | **Ngoại lệ:** B → N (hủy) hoặc B → NS (không đến)

## Quick Run: Fetch API → Import DB
```bash
# 1. Start server (port 2090)
cd IBDO-PMS && node server.js

# 2. Web UI: http://localhost:2090
#    - Paste Bearer Token → chọn ngày/status → Fetch → Import to MySQL

# 3. Hoặc CLI (không cần server):
#    Fetch mới từ API (thay TOKEN):
node -e '
const https=require("https"),fs=require("fs");
const TOKEN="PASTE_TOKEN_HERE";
const API="https://openapi.idbtech.io/IDBOpenApi/v2/reservations";
function httpGet(u){return new Promise((ok,no)=>{https.get(u,{headers:{Authorization:"Bearer "+TOKEN,Accept:"application/json"}},(r)=>{let b="";r.on("data",c=>b+=c);r.on("end",()=>r.statusCode===200?ok(JSON.parse(b)):no(new Error("HTTP "+r.statusCode)))}).on("error",no)})}
async function main(){let all=[],p=1;while(true){const d=await httpGet(API+"?arrivalFrom=01/01/2026&arrivalTo=31/12/2026&reservationStatus=B,IP,IC,OP,C,N,NS&pageNo="+p+"&size=200");let r=d;if(Array.isArray(r)&&r.length===1&&r[0].res_msg)r=r[0];let l=r.res_msg||[];if(!l.length)break;all.push(...l);console.log("Page "+p+": "+l.length+" records");if(l.length<200||(r.totalPage&&p>=r.totalPage))break;p++}fs.writeFileSync("exports/reservations_extracted.json",JSON.stringify(all,null,2));console.log("Saved "+all.length+" reservations")}
main().catch(e=>{console.error(e.message);process.exit(1)});
'

#    Import vào DB:
node import-db.js exports/reservations_extracted.json
```

## DB Connection (import-db.js)
| Field | Value |
|---|---|
| Host | 14.225.211.84 |
| Port | 3306 |
| Database | laravel_db_app |
| Table | ohip_res |
| User | laravel_app_hyte |
| Mode | skip_existing (by reservation_id + rooming_list_id) |

## Known Issues
- Email sometimes stored in guestAddress field → script detects via regex
- roomingListRoom is NULL when status = B (not yet assigned)
- birthday is always empty in current dataset (0/50)
- guestEmail often empty, actual email in guestAddress
