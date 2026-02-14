const BaseParser = require('./base');

/**
 * MissionParser - Mission Acceptance, Objectives, and Completion (SC 4.6+)
 * 
 * KNOWN LOG FORMATS:
 * 
 * MISSION ENDED (structured):
 *   <MissionEnded> mission_id [2edcff7c-fe60-473f-98ae-c4205d796d93] - mission_state [MISSION_STATE_SUCCEEDED]
 *   States: MISSION_STATE_SUCCEEDED, MISSION_STATE_FAILED, MISSION_STATE_ABANDONED
 * 
 * NOTIFICATION-BASED (from SHUDEvent):
 *   Added notification "Contract Accepted: Mission Title"
 *   Added notification "New Objective: Do the thing"
 *   Added notification "Contract Complete: Mission Title"
 *   Added notification "Contract Failed: Mission Title"
 * 
 * MISSION ACCEPTANCE (MobiGlas):
 *   MobiGlas::OnAcceptMission (may or may not include mission ID)
 * 
 * NOTE: MissionId appears on many notification lines as metadata:
 *   MissionId: [UUID], ObjectiveId: [string]
 */
class MissionParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            // Structured mission end with UUID and state
            mission_ended_structured: /<MissionEnded>\s*mission_id\s*\[([^\]]+)\]\s*-\s*mission_state\s*\[([^\]]+)\]/i,

            // Generic tag detection
            mission_ended_tag: /<MissionEnded>/,
            mission_objective_tag: /<ObjectiveUpserted>/,

            // Notification-based patterns (from SHUDEvent_OnNotification)
            contract_accepted: /Added notification "Contract Accepted:\s*([^"]+)"/i,
            contract_complete: /Added notification "Contract Complete[d]?:\s*([^"]+)"/i,
            contract_failed: /Added notification "Contract Failed:\s*([^"]+)"/i,
            new_objective: /Added notification "New Objective:\s*([^"]+)"/i,

            // MobiGlas accept
            mobiglas_accept: /MobiGlas::OnAcceptMission/i,

            // Mission ID from notification metadata
            notification_mission_id: /MissionId:\s*\[([^\]]+)\]/i,
            notification_objective_id: /ObjectiveId:\s*\[([^\]]*)\]/i,

            // Tracked mission change
            tracked_mission: /TrackedMission|MissionMarker/i,
        };
        this.missionMap = new Map(); // UUID -> Title
        this.lastSeenId = null;
        this.lastSeenIdTime = 0;
    }

    parse(line) {
        let handled = false;
        const now = Date.now();

        // ── 0. Extract Mission ID from ANY line (short-term buffer) ──
        const idMatch = line.match(this.patterns.notification_mission_id);
        if (idMatch && idMatch[1] !== '00000000-0000-0000-0000-000000000000') {
            this.lastSeenId = idMatch[1];
            this.lastSeenIdTime = now;
        }

        const effectiveId = idMatch && idMatch[1] !== '00000000-0000-0000-0000-000000000000'
            ? idMatch[1]
            : (now - this.lastSeenIdTime < 5000 ? this.lastSeenId : null);

        // ── 1. Mission Ended (structured format) ──
        const structuredEnd = line.match(this.patterns.mission_ended_structured);
        if (structuredEnd) {
            const [_, missionId, stateRaw] = structuredEnd;
            const state = stateRaw.toLowerCase();
            const isSuccess = state.includes('succeeded') || state.includes('complete');
            const isAbandoned = state.includes('abandoned');
            const status = isSuccess ? 'completed' : (isAbandoned ? 'abandoned' : 'failed');
            const title = this.missionMap.get(missionId) || null;

            this.emit('gamestate', {
                type: 'MISSION_STATUS',
                value: status,
                id: missionId,
                title
            });

            if (missionId) this.missionMap.delete(missionId);
            handled = true;
        }

        // ── 2. Contract Accepted (notification) ──
        const acceptMatch = line.match(this.patterns.contract_accepted);
        if (acceptMatch) {
            let title = acceptMatch[1].trim();
            if (title.endsWith(':')) title = title.slice(0, -1).trim();

            if (effectiveId) {
                this.missionMap.set(effectiveId, title);
            }

            this.emit('gamestate', {
                type: 'MISSION_ACCEPTED',
                value: title,
                id: effectiveId
            });
            handled = true;
        }

        // ── 3. New Objective (notification) ──
        const objMatch = line.match(this.patterns.new_objective);
        if (objMatch) {
            const objective = objMatch[1].trim();
            this.emit('gamestate', {
                type: 'MISSION_OBJECTIVE',
                value: objective,
                id: effectiveId
            });
            handled = true;
        }

        // ── 4. Contract Complete (notification) ──
        const completeMatch = line.match(this.patterns.contract_complete);
        if (completeMatch) {
            let title = completeMatch[1].trim();
            this.emit('gamestate', {
                type: 'MISSION_STATUS',
                value: 'completed',
                title,
                id: effectiveId
            });
            if (effectiveId) this.missionMap.delete(effectiveId);
            handled = true;
        }

        // ── 5. Contract Failed (notification) ──
        const failMatch = line.match(this.patterns.contract_failed);
        if (failMatch) {
            let title = failMatch[1].trim();
            this.emit('gamestate', {
                type: 'MISSION_STATUS',
                value: 'failed',
                title,
                id: effectiveId
            });
            if (effectiveId) this.missionMap.delete(effectiveId);
            handled = true;
        }

        // ── 6. Generic <MissionEnded> fallback (if structured didn't match) ──
        if (!handled && this.patterns.mission_ended_tag.test(line)) {
            const isSuccess = line.includes('Success') || line.includes('Complete') || line.includes('SUCCEEDED');
            const status = isSuccess ? 'completed' : 'failed';
            this.emit('gamestate', { type: 'MISSION_STATUS', value: status, id: effectiveId });
            if (effectiveId) this.missionMap.delete(effectiveId);
            handled = true;
        }

        // ── 7. Tracked Mission Change ──
        if (this.patterns.tracked_mission.test(line)) {
            if (effectiveId && this.missionMap.has(effectiveId)) {
                const title = this.missionMap.get(effectiveId);
                this.emit('gamestate', { type: 'MISSION_CHANGED', value: title, id: effectiveId });
                handled = true;
            }
        }

        return handled;
    }
}

module.exports = new MissionParser();

