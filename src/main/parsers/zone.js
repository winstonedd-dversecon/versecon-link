const BaseParser = require('./base');

class ZoneParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            armistice_enter: /Notification "You have entered an Armistice Zone"/i,
            armistice_leave: /Notification "You have left an Armistice Zone"/i,
            monitored_enter: /Notification "Entered Monitored Space"/i,
            monitored_leave: /Notification "Left Monitored Space"/i,
            // Fallback for Ruleset lines if Notifications are suppressed?
            ruleset_armistice_enter: /<RulesetManager>.*Entered Armistice Zone/i,
            ruleset_armistice_leave: /<RulesetManager>.*Left Armistice Zone/i
        };
    }

    parse(line) {
        let handled = false;

        if (this.patterns.armistice_enter.test(line) || this.patterns.ruleset_armistice_enter.test(line)) {
            this.emit('gamestate', { type: 'ZONE', value: 'armistice_enter' });
            handled = true;
        }
        else if (this.patterns.armistice_leave.test(line) || this.patterns.ruleset_armistice_leave.test(line)) {
            this.emit('gamestate', { type: 'ZONE', value: 'armistice_leave' });
            handled = true;
        }
        else if (this.patterns.monitored_enter.test(line)) {
            this.emit('gamestate', { type: 'ZONE', value: 'monitored_enter' });
            handled = true;
        }
        else if (this.patterns.monitored_leave.test(line)) {
            this.emit('gamestate', { type: 'ZONE', value: 'monitored_leave' });
            handled = true;
        }

        return handled;
    }
}

module.exports = new ZoneParser();
