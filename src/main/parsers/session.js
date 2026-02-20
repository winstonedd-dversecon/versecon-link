const BaseParser = require('./base');

class SessionParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            log_start: /^<([^>]+)> Log started on/i,
            build_info: /Build\((\d+)\)/i, // Capture build number
            environment: /\[Trace\] Environment:\s+(\w+)/i,
            session_id: /\[Trace\] @session:\s+'([^']+)'/i,
            system_quit: /<SystemQuit>\s+CSystem::Quit invoked/i,

            // Server Transitions (verified in Game.log)
            server_change_start: /<Change Server Start>/i,
            server_change_end: /<Change Server End>/i,
            context_done: /<Context Establisher Done>/i,
        };
        this.sessionData = {
            startTime: null,
            build: null,
            env: null,
            sessionId: null
        };
    }

    parse(line) {
        let handled = false;

        // 1. Session Start Time (only emit ONCE to prevent timer resets)
        if (!this.sessionData.startTime) {
            const startMatch = line.match(this.patterns.log_start);
            if (startMatch) {
                const timestamp = startMatch[1];
                this.sessionData.startTime = timestamp;
                this.emit('gamestate', { type: 'SESSION_START', value: timestamp });
                handled = true;
            }
        }

        // 2. Build Info
        if (!this.sessionData.build) {
            const buildMatch = line.match(this.patterns.build_info);
            if (buildMatch) {
                this.sessionData.build = buildMatch[1];
                this.emit('gamestate', { type: 'BUILD_INFO', value: this.sessionData.build });
                handled = true;
            }
        }

        // 3. Environment
        if (!this.sessionData.env) {
            const envMatch = line.match(this.patterns.environment);
            if (envMatch) {
                this.sessionData.env = envMatch[1];
                this.emit('gamestate', { type: 'SERVER_ENV', value: this.sessionData.env });
                handled = true;
            }
        }

        // 4. Session ID
        if (!this.sessionData.sessionId) {
            const sessionMatch = line.match(this.patterns.session_id);
            if (sessionMatch) {
                this.sessionData.sessionId = sessionMatch[1];
                this.emit('gamestate', { type: 'SESSION_ID', value: this.sessionData.sessionId });
                handled = true;
            }
        }

        // 5. System Quit
        if (this.patterns.system_quit.test(line)) {
            this.emit('gamestate', { type: 'GAME_LEAVE', value: 'SystemQuit' });
            handled = true;
        }

        // 6. Server Transfer Start
        if (this.patterns.server_change_start.test(line)) {
            this.emit('gamestate', {
                type: 'STATUS',
                value: 'SERVER TRANSFER IN PROGRESS',
                level: 'WARNING'
            });
            handled = true;
        }

        // 7. Server Transfer End
        if (this.patterns.server_change_end.test(line)) {
            this.emit('gamestate', {
                type: 'STATUS',
                value: 'SERVER TRANSFER COMPLETE',
                level: 'INFO'
            });
            handled = true;
        }

        // 8. Context Establisher Done (loading complete after server hop)
        if (this.patterns.context_done.test(line)) {
            this.emit('gamestate', {
                type: 'STATUS',
                value: 'WORLD LOADED',
                level: 'INFO'
            });
            handled = true;
        }

        return handled;
    }
}

module.exports = new SessionParser();
