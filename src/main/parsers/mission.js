const BaseParser = require('./base');

class MissionParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            mission_shared: /<MissionShared>/,
            mission_objective: /<ObjectiveUpserted>/,
            mission_ended: /<MissionEnded>/,
            mission_end_structured: /<EndMission>/,
            contract_available: /<ContractAvailable>/,
            contract_accepted: /<ContractAccepted>/,
            reputation: /<Reputation>/,
            // Capture ID: MissionID="123" or MissionID: 123 or Mission[123]
            mission_id: /(?:MissionID|Mission|ContractID)[:=]?\s*\[?"?(\d+)"?\]?/i
        };
        this.missionMap = new Map(); // ID -> Title
        this.lastSeenId = null;
        this.lastSeenIdTime = 0;
    }

    parse(line) {
        let handled = false;
        const now = Date.now();

        // 0. Extract Mission ID (if present on ANY line)
        // This acts as a short-term buffer because ID often appears on preceding line
        const idMatch = line.match(this.patterns.mission_id);
        if (idMatch) {
            this.lastSeenId = idMatch[1];
            this.lastSeenIdTime = now;
        }

        // Expiration for ID buffer (e.g. 2 seconds) to prevent stale association
        // But for "Completed", the ID might have been seen 100ms ago.
        let effectiveId = idMatch ? idMatch[1] : (now - this.lastSeenIdTime < 5000 ? this.lastSeenId : null);

        // 1. Mission Accepted
        // Case A: MobiGlas Event (Reliable ID)
        if (line.includes('MobiGlas::OnAcceptMission')) {
            // Try to find ID
            if (effectiveId) {
                // We need the title. Often not on this line. 
                // But we might have a Notification line nearby.
                // For now, tracking the ID is enough to bind the NEXT notification.
            }
        }

        // Case B: Notification (Has Title, usually no ID)
        const contractMatch = line.match(/Notification "Contract Accepted:\s*([^"]+)"/i);
        if (contractMatch) {
            let title = contractMatch[1].trim();
            if (title.endsWith(':')) title = title.slice(0, -1).trim();

            if (effectiveId) {
                this.missionMap.set(effectiveId, title);
            }

            // If checking fails, we still emit. main.js handles ID generation if missing.
            this.emit('gamestate', { type: 'MISSION_ACCEPTED', value: title, id: effectiveId });
            handled = true;
        }

        // 1b. Tracked Mission Switch (Marker Update)
        // User says: "updates my marker with the mission ID"
        // Let's look for <SetTrackedMission> or similar, or just assume any line with ONLY MissionID implies tracking?
        // Risky. Let's look for "Track" or "Marker".
        if (line.includes('TrackedMission') || line.includes('MissionMarker')) {
            if (effectiveId && this.missionMap.has(effectiveId)) {
                const title = this.missionMap.get(effectiveId);
                this.emit('gamestate', { type: 'MISSION_CHANGED', value: title, id: effectiveId });
                handled = true;
            }
        }

        // 2. Objective Update
        const objMatch = line.match(/Notification "New Objective:\s*([^"]+)"/i);
        if (objMatch) {
            const objective = objMatch[1].trim();
            this.emit('gamestate', { type: 'MISSION_OBJECTIVE', value: objective, id: effectiveId });
            handled = true;
        }

        // 3. Mission Ended
        // Regex for standard log vs notification
        if (this.patterns.mission_ended.test(line) || /Notification "Contract (Complete|Failed)/i.test(line)) {
            const isSuccess = line.includes('Success') || line.includes('Complete');
            const status = isSuccess ? 'completed' : 'failed';

            this.emit('gamestate', { type: 'MISSION_STATUS', value: status, id: effectiveId });

            if (effectiveId) this.missionMap.delete(effectiveId);
            handled = true;
        }

        return handled;
    }
}

module.exports = new MissionParser();
