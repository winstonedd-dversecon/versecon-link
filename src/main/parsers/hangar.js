const BaseParser = require('./base');

class HangarParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            // <2026-02-09T21:37:49.559Z> [Notice] <CSCLoadingPlatformManager::TransitionLightGroupState> [Loading Platform] Loading Platform Manager [LoadingPlatformManager_ShipElevator_HangarMediumTop] transitioning light state in current platform state: OpenIdle [Team_CoreGameplayFeatures][Cargo]
            platform_state: /<CSCLoadingPlatformManager::TransitionLightGroupState>.*platform manager '([^']+)'.*state:\s+(\w+)/i,

            // Generic ATC Assignment Fallback
            atc_assigned: /Notification "Landing pad ([^"]+) assigned"/i
        };
        this.currentState = null;
    }

    parse(line) {
        let handled = false;

        const platformMatch = line.match(this.patterns.platform_state);
        if (platformMatch) {
            const manager = platformMatch[1];
            const state = platformMatch[2];

            // We primarily care about ShipElevators for the Hangar Timer
            if (manager.includes('ShipElevator')) {
                // States like 'MovingToTop', 'MovingToBottom', 'OpenIdle'
                const isActive = state.startsWith('Moving') || state === 'OpenIdle';
                const type = state.startsWith('Moving') ? 'TRANSIT' : (state === 'OpenIdle' ? 'READY' : 'CLOSED');

                this.emit('gamestate', {
                    type: 'HANGAR_STATE',
                    value: type,
                    manager: manager,
                    rawState: state
                });
                handled = true;
            }
        }

        const atcMatch = line.match(this.patterns.atc_assigned);
        if (atcMatch) {
            this.emit('gamestate', {
                type: 'HANGAR_ASSIGNED',
                value: atcMatch[1]
            });
            handled = true;
        }

        return handled;
    }
}

module.exports = new HangarParser();
