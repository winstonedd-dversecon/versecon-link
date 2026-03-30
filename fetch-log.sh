#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# VerseCon Link — Game.log Fetcher
# ═══════════════════════════════════════════════════════════════
# Pulls the latest Game.log from the Windows gaming PC to this
# project for parser development and log analysis.
#
# SETUP (one-time):
#   1. Install OpenSSH Server on Windows PC:
#      Settings > Apps > Optional Features > Add "OpenSSH Server"
#      Then: Start-Service sshd (in PowerShell as Admin)
#
#   2. Set your Windows PC IP/hostname and username below:
WINDOWS_HOST="${VCON_WINDOWS_HOST:-gaming-pc}"
WINDOWS_USER="${VCON_WINDOWS_USER:-damien}"
#
#   3. Or set environment variables:
#      export VCON_WINDOWS_HOST=192.168.1.100
#      export VCON_WINDOWS_USER=damien
#
# ═══════════════════════════════════════════════════════════════

# Source and destination
WINDOWS_LOG_PATH="/C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log"
LOCAL_DEST="$(dirname "$0")/src"

# Timestamp for backup
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "═══ VerseCon Link — Log Fetcher ═══"
echo ""

# Check if we can reach the host
if ! ping -c 1 -W 2 "$WINDOWS_HOST" &>/dev/null; then
    echo "⚠️  Cannot reach $WINDOWS_HOST"
    echo ""
    echo "Options:"
    echo "  1. Set the IP:  export VCON_WINDOWS_HOST=192.168.1.xxx"
    echo "  2. Or manually copy Game.log to: $LOCAL_DEST/"
    echo ""
    echo "Manual copy (from Windows PowerShell):"
    echo "  scp \"C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\Game.log\" ${USER}@$(hostname -I | awk '{print $1}'):${LOCAL_DEST}/Game.log"
    exit 1
fi

echo "📡 Connecting to $WINDOWS_USER@$WINDOWS_HOST..."

# Backup existing log if present
if [ -f "$LOCAL_DEST/Game.log" ]; then
    BACKUP_NAME="Game_${TIMESTAMP}.log"
    echo "📦 Backing up current Game.log → $BACKUP_NAME"
    cp "$LOCAL_DEST/Game.log" "$LOCAL_DEST/$BACKUP_NAME"
fi

# Fetch via SCP
echo "⬇️  Fetching Game.log..."
scp "$WINDOWS_USER@$WINDOWS_HOST:\"$WINDOWS_LOG_PATH\"" "$LOCAL_DEST/Game.log"

if [ $? -eq 0 ]; then
    SIZE=$(wc -l < "$LOCAL_DEST/Game.log")
    BYTES=$(stat --format="%s" "$LOCAL_DEST/Game.log" 2>/dev/null || stat -f%z "$LOCAL_DEST/Game.log" 2>/dev/null)
    echo ""
    echo "✅ Game.log fetched successfully!"
    echo "   Lines: $SIZE"
    echo "   Size:  $(numfmt --to=iec $BYTES 2>/dev/null || echo "${BYTES} bytes")"
    echo "   Path:  $LOCAL_DEST/Game.log"
    echo ""
    echo "Quick analysis:"
    echo "   Deaths:     $(grep -c '<Actor Death>' "$LOCAL_DEST/Game.log" 2>/dev/null || echo 0)"
    echo "   Ships:      $(grep -c 'joined channel' "$LOCAL_DEST/Game.log" 2>/dev/null || echo 0)"
    echo "   Locations:  $(grep -c 'RequestLocationInventory' "$LOCAL_DEST/Game.log" 2>/dev/null || echo 0)"
    echo "   Missions:   $(grep -c 'MissionEnded\|ContractAccepted' "$LOCAL_DEST/Game.log" 2>/dev/null || echo 0)"
    echo "   Fire sims:  $(grep -c 'Fire Client' "$LOCAL_DEST/Game.log" 2>/dev/null || echo 0)"
else
    echo ""
    echo "❌ SCP failed. Try manually:"
    echo "   scp $WINDOWS_USER@$WINDOWS_HOST:\"$WINDOWS_LOG_PATH\" $LOCAL_DEST/Game.log"
fi
