const BaseParser = require('./base');

class HangarParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            // <2026-02-09T21:37:49.559Z> [Notice] <CSCLoadingPlatformManager::TransitionLightGroupState> [Loading Platform] Loading Platform Manager [LoadingPlatformManager_ShipElevator_HangarMediumTop] transitioning light state in current platform state: OpenIdle [Team_CoreGameplayFeatures][Cargo]
            platform_state: /<CSCLoadingPlatformManager::TransitionLightGroupState>.*platform manager '([^']+)'.*state:\s+(\w+)/i,

            // New 4.0 Platform Changed Event
            platform_changed: /Loading Platform Manager \[(LoadingPlatformManager_[^\]]+)\] Platform state changed to (\w+)/i,

            // Generic ATC Assignment Fallback
            atc_assigned: /Notification "Landing pad ([^"]+) assigned"/i,

            // ATC request complete / hangar request completed
            hangar_request: /(?:Added notification "Hangar Request Completed:\s*|Notification "Hangar Request Completed:\s*|(?:\s*|^)"Hangar Request Completed:\s*)([^"]*)"/i
        };
        this.lastTacticalHangar = null;
        this.lastTacticalHangarTime = 0;
        this.lastHangarState = null;
        this.lastHangarStateTime = 0;
    }

    emitTacticalHangar(value, manager, rawState) {
        const now = Date.now();
        if (value === this.lastTacticalHangar && (now - this.lastTacticalHangarTime) < 3000) {
            return;
        }
        this.lastTacticalHangar = value;
        this.lastTacticalHangarTime = now;
        this.emit('gamestate', {
            type: 'TACTICAL_HANGAR',
            value,
            manager,
            rawState
        });
    }

    emitHangarState(value, manager, rawState) {
        const now = Date.now();
        if (value === this.lastHangarState && (now - this.lastHangarStateTime) < 3000) {
            return;
        }
        this.lastHangarState = value;
        this.lastHangarStateTime = now;
        this.emit('gamestate', {
            type: 'HANGAR_STATE',
            value,
            manager,
            rawState
        });
    }

    parse(line) {
        let handled = false;

        const changedMatch = line.match(this.patterns.platform_changed);
        if (changedMatch) {
            const manager = changedMatch[1];
            const state = changedMatch[2];

            if (manager.includes('ShipElevator')) {
                let cleanHangar = manager.replace('LoadingPlatformManager_ShipElevator_', '').replace(/_/g, ' ');
                let cleanState = state.replace('Platform', '').replace('LoadingGate', ' Doors');
                cleanHangar = cleanHangar.replace(/([A-Z])/g, ' $1').trim();
                cleanState = cleanState.replace(/([A-Z])/g, ' $1').trim().toLowerCase();

                this.emitTacticalHangar(`${cleanHangar}: ${cleanState}`, manager, state);
                
                // Keep the legacy HANGAR_STATE for timers
                const type = state.startsWith('Raising') || state.startsWith('Moving') || state === 'LoweringPlatform' ? 'TRANSIT' : (state === 'OpenIdle' || state === 'Open' ? 'READY' : 'CLOSED');
                this.emitHangarState(type, manager, state);
                handled = true;
            }
        }

        if (!handled) {
            const platformMatch = line.match(this.patterns.platform_state);
            if (platformMatch) {
                const manager = platformMatch[1];
                const state = platformMatch[2];

                if (manager.includes('ShipElevator')) {
                    const type = state.startsWith('Moving') ? 'TRANSIT' : (state === 'OpenIdle' ? 'READY' : 'CLOSED');
                    this.emitHangarState(type, manager, state);
                    handled = true;
                }
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

        const hangarReqMatch = line.match(this.patterns.hangar_request);
        if (hangarReqMatch) {
            this.emitHangarState('READY', 'ATC', 'Hangar Request Completed');
            this.emitTacticalHangar('Hangar: Opening Doors', 'ATC', 'Hangar Request Completed');
            handled = true;
        }

        return handled;
    }
}

module.exports = new HangarParser();
