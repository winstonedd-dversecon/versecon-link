const fs = require('fs');
const { EventEmitter } = require('events');

class LogPoller extends EventEmitter {
    constructor(filePath, intervalMs = 50) {
        super();
        this.filePath = filePath;
        this.intervalMs = intervalMs;
        this.lastSize = 0;
        this.intervalId = null;
        this.buffer = '';
    }

    start() {
        if (this.intervalId) return;

        try {
            // Initial stats
            if (fs.existsSync(this.filePath)) {
                const stats = fs.statSync(this.filePath);
                this.lastSize = stats.size;
            }
        } catch (e) {
            this.emit('error', e);
        }

        console.log(`[LogPoller] Starting poll on ${this.filePath} (${this.intervalMs}ms)`);

        this.intervalId = setInterval(() => this.poll(), this.intervalMs);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('[LogPoller] Stopped');
        }
    }

    poll() {
        try {
            if (!fs.existsSync(this.filePath)) return;

            const stats = fs.statSync(this.filePath);

            if (stats.size > this.lastSize) {
                // File grew - Read appended content
                const stream = fs.createReadStream(this.filePath, {
                    start: this.lastSize,
                    end: stats.size - 1,
                    encoding: 'utf-8'
                });

                stream.on('data', (chunk) => {
                    this.buffer += chunk;
                    this.processBuffer();
                });

                stream.on('error', (err) => this.emit('error', err));

                this.lastSize = stats.size;

            } else if (stats.size < this.lastSize) {
                // File shrank = Rotated
                console.log('[LogPoller] File rotation detected');
                this.lastSize = 0; // Reset to start
                this.emit('rotation');
            }
        } catch (e) {
            this.emit('error', e);
        }
    }

    processBuffer() {
        let lines = this.buffer.split(/\r?\n/);
        // Keep the last partial line in the buffer
        this.buffer = lines.pop(); // The last item is either empty string (if ends with newline) or incomplete line

        for (const line of lines) {
            if (line.trim()) {
                this.emit('line', line);
            }
        }
    }
}

module.exports = LogPoller;
