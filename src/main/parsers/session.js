const BaseParser = require('./base');

class SessionParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            log_start: /^<([^>]+)> Log started on/i,
            build_info: /Build\((\d+)\)/i, // Capture build number
            environment: /\[Trace\] Environment:\s+(\w+)/i,
            session_id: /\[Trace\] @session:\s+'([^']+)'/i
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

        // 1. Session Start Time
        const startMatch = line.match(this.patterns.log_start);
        if (startMatch) {
            const timestamp = startMatch[1];
            this.sessionData.startTime = timestamp;
            this.emit('gamestate', { type: 'SESSION_START', value: timestamp });
            handled = true;
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

        return handled;
    }
}

module.exports = new SessionParser();
