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
            // Capture ID: MissionID="123" or MissionID: 123
            mission_id: /MissionID[:=]\s*"?(\d+)"?/i
        };
        this.missionMap = new Map(); // ID -> Title
    }

    parse(line) {
        let handled = false;

        // 0. Extract Mission ID (if present)
        let currentId = null;
        const idMatch = line.match(this.patterns.mission_id);
        if (idMatch) currentId = idMatch[1];

        // 1. Mission Accepted (via Notification)
        // [Notice] <UpdateNotificationItem> Notification "Contract Accepted: Delivery in the Dark"
        // TODO: This notification line might NOT have the ID. 
        // We might need to correlate via previous <ContractAccepted> line which usually has ID.

        const contractMatch = line.match(/Notification "Contract Accepted:\s*([^"]+)"/i);
        if (contractMatch) {
            let title = contractMatch[1].trim();
            if (title.endsWith(':')) title = title.slice(0, -1).trim();

            // If we found an ID in this line, map it
            if (currentId) {
                this.missionMap.set(currentId, title);
            }
            // If no ID on this line, we might have seen <ContractAccepted> recently with an ID.
            // For now, just emit both.

            this.emit('gamestate', { type: 'MISSION_ACCEPTED', value: title, id: currentId });
            handled = true;
        }

        // 1b. Tracked Mission Switch (Marker Update)
        // User says: "updates my marker with the mission ID"
        // Let's look for <SetTrackedMission> or similar, or just assume any line with ONLY MissionID implies tracking?
        // Risky. Let's look for "Track" or "Marker".
        if (line.includes('TrackedMission') || line.includes('MissionMarker')) {
            if (currentId && this.missionMap.has(currentId)) {
                const title = this.missionMap.get(currentId);
                this.emit('gamestate', { type: 'MISSION_CHANGED', value: title, id: currentId });
                handled = true;
            }
        }

        // 2. Objective Update
        const objMatch = line.match(/Notification "New Objective:\s*([^"]+)"/i);
        if (objMatch) {
            const objective = objMatch[1].trim();
            this.emit('gamestate', { type: 'MISSION_OBJECTIVE', value: objective, id: currentId });
            handled = true;
        }

        // 3. Mission Ended
        if (this.patterns.mission_ended.test(line) || /Notification "Contract Complete/i.test(line)) {
            const status = line.includes('Success') || line.includes('Complete') ? 'completed' :
                line.includes('Fail') || line.includes('Failed') ? 'failed' : 'ended';

            this.emit('gamestate', { type: 'MISSION_STATUS', value: status, id: currentId });

            // Cleanup map
            if (currentId) this.missionMap.delete(currentId);
            handled = true;
        }

        return handled;
    }
}

module.exports = new MissionParser();
