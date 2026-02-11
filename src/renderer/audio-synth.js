class AudioSynth {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.5; // Default volume
        this.masterGain.connect(this.ctx.destination);
        this.enabled = true;
    }

    setVolume(val) {
        this.masterGain.gain.value = Math.max(0, Math.min(1, val));
    }

    toggle(state) {
        this.enabled = state;
    }

    play(type) {
        if (!this.enabled) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        switch (type) {
            case 'alert_death': this.playDeath(); break;
            case 'alert_status': this.playKlaxon(400, 300, 0.5); break; // Low warning
            case 'alert_zone': this.playChime(600, 0.4); break; // Warning chime
            case 'alert_interdiction': this.playSiren(); break;
            case 'notification': this.playPing(800); break;
            case 'contract': this.playSuccess(); break;
            case 'beacon': this.playPulse(150, 0.8); break; // Deep pulse
            case 'sos': this.playSOS(); break;
            default: this.playPing(440);
        }
    }

    // 💀 Flatline Sound
    playDeath() {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 2);

        gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 2);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + 2);
    }

    // 🚨 Emergency Siren
    playSiren() {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const lfo = this.ctx.createOscillator();

        osc.type = 'square';
        lfo.type = 'sine';
        lfo.frequency.value = 4; // 4Hz siren speed

        const mod = this.ctx.createGain();
        mod.gain.value = 200; // Pitch modulation depth

        lfo.connect(mod);
        mod.connect(osc.frequency);

        osc.frequency.value = 600;

        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 3);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        lfo.start();
        osc.stop(this.ctx.currentTime + 3);
        lfo.stop(this.ctx.currentTime + 3);
    }

    // ⚠️ Warning Klaxon
    playKlaxon(freq, endFreq, dur) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(endFreq, this.ctx.currentTime + dur);

        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + dur);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + dur);
    }

    // ℹ️ Notification Ping
    playPing(freq) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.5);
    }

    // ✅ Success Chime
    playSuccess() {
        this.playPing(600);
        setTimeout(() => this.playPing(900), 100);
    }

    // 🆘 Distress Pulse
    playPulse(freq, speed) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.value = freq;

        gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
        gain.gain.setValueAtTime(0, this.ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.4, this.ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0, this.ctx.currentTime + 0.3);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.5);
    }

    // ... SOS Morse Code
    playSOS() {
        // ... omitted for brevity, can map simply to playPulse
        this.playSiren();
    }
}

// Export singleton
if (typeof window !== 'undefined') {
    window.audioSynth = new AudioSynth();
}
if (typeof module !== 'undefined') {
    module.exports = AudioSynth;
}
