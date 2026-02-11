const BaseParser = require('./base');

class MissionParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            mission_shared: /<MissionShared>/,
            mission_objective: /<ObjectiveUpserted>/,
            // ObjectiveUpserted usually contains JSON-like or structured data about the objective
            // e.g. "Objective 'Goto' status: 'Active'"

            mission_ended: /<MissionEnded>/,
            mission_end_structured: /<EndMission>/,
            contract_available: /<ContractAvailable>/,
            contract_accepted: /<ContractAccepted>/,
            reputation: /<Reputation>/
        };
    }

    parse(line) {
        let handled = false;

        // 1. Mission Status
        if (this.patterns.mission_shared.test(line)) {
            this.emit('gamestate', { type: 'MISSION', value: 'shared' });
            handled = true;
        }

        // 2. Objectives
        if (this.patterns.mission_objective.test(line)) {
            // Extract objective details if possible
            // For now, just a generic update signal
            this.emit('gamestate', { type: 'MISSION', value: 'objective_update' });
            handled = true;
        }

        // 3. Contracts
        if (this.patterns.contract_accepted.test(line)) {
            this.emit('gamestate', { type: 'CONTRACT', value: 'accepted' });
            handled = true;
        }

        // 4. Completion
        if (this.patterns.mission_ended.test(line) || this.patterns.mission_end_structured.test(line)) {
            // Check for success/failure in the line
            const status = line.includes('Success') ? 'completed' :
                line.includes('Fail') ? 'failed' : 'ended';

            this.emit('gamestate', { type: 'MISSION', value: status });
            handled = true;
        }

        return handled;
    }
}

module.exports = new MissionParser();
