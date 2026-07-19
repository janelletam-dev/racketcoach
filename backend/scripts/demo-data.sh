#!/usr/bin/env bash
set -euo pipefail

# Load demo history through the PUBLIC board API — the exact call the coach
# station makes (POST /api/session, authorized by pairing code). Use this when
# the seed is gated off (prod), to dress the dashboard for a demo. Run once,
# deliberately, by a human.
#
# Usage:
#   ./demo-data.sh CODE [BACKEND_URL] [TOKEN]
#     CODE         a pairing code already claimed in the UI (e.g. ACE123)
#     BACKEND_URL  default http://localhost:3001
#     TOKEN        optional session token; if given, claims CODE first
#
# If CODE is not yet claimed and no TOKEN is passed, the board returns 202 and
# stores nothing — claim the code in the app first, or pass a session token.

CODE="${1:?usage: demo-data.sh CODE [BACKEND_URL] [TOKEN]}"
BACKEND_URL="${2:-http://localhost:3001}"
TOKEN="${3:-}"

# good/total -> 42% .. 71% (rising); streaks 6..18; faults vary
GOOD=(42 52 61 66 71)
TOTAL=(100 110 105 118 100)
STREAK=(6 9 12 15 18)
FAULT=("late paddle" "open face" "late paddle" "wrist snap" "late paddle")
SPEED=(9.4 10.1 11.0 11.8 12.6)

if [ -n "$TOKEN" ]; then
  echo "claiming $CODE ..."
  curl -fsS -X POST "$BACKEND_URL/api/pairings/claim" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"code\":\"$CODE\"}" >/dev/null && echo "  claimed"
fi

for i in 0 1 2 3 4; do
  weeks_ago=$((4 - i)) # oldest first
  DATE=$(python3 -c "import datetime; print((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(weeks=$weeks_ago)).isoformat())")
  echo "POST session $((i + 1))/5  (${GOOD[$i]}/${TOTAL[$i]})  played $DATE"
  curl -fsS -o /dev/null -w "  -> %{http_code}\n" -X POST "$BACKEND_URL/api/session" \
    -H "Content-Type: application/json" \
    -d "{\"pairingCode\":\"$CODE\",\"date\":\"$DATE\",\"goodReps\":${GOOD[$i]},\"totalReps\":${TOTAL[$i]},\"bestStreak\":${STREAK[$i]},\"commonFault\":\"${FAULT[$i]}\",\"avgSpeed\":${SPEED[$i]}}"
done
echo "done. open the dashboard for the paired user."
