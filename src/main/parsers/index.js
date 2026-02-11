const { EventEmitter } = require('events');

class LogEngine extends EventEmitter {
    constructor() {
        super();
        this.parsers = [];
    }

    /**
     * Register a parser module.
     * @param {BaseParser} parser 
     */
    register(parser) {
        // Forward events from the parser up to the Engine
        // e.g. parser.emit('gamestate', data) -> Engine.emit('gamestate', data)
        parser.on('gamestate', (data) => this.emit('gamestate', data));
        parser.on('login', (data) => this.emit('login', data));
        parser.on('unknown', (data) => this.emit('unknown', data));

        this.parsers.push(parser);
    }

    /**
     * Process a line through all registered parsers.
     * Returns true if ANY parser handled it.
     */
    process(line, context = {}) {
        let handled = false;
        for (const parser of this.parsers) {
            try {
                if (parser.parse(line, context)) {
                    handled = true;
                }
            } catch (e) {
                console.error(`[LogEngine] Parser error: ${e.message}`, e);
            }
        }
        return handled;
    }
}

// Instantiate and register parsers
const engine = new LogEngine();
engine.register(require('./navigation'));
engine.register(require('./vehicle'));
engine.register(require('./combat'));
engine.register(require('./mission'));
engine.register(require('./economy'));
engine.register(require('./zone'));
engine.register(require('./custom'));

module.exports = engine;
