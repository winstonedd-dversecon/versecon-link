const { SquadHost } = require('./src/main/squad-host');
const { SquadPeer } = require('./src/main/squad-peer');

async function run() {
    const host = new SquadHost();
    const info = await host.start({ handle: 'HostUser' }, 30000);
    console.log('Host started:', info);

    const peer = new SquadPeer();
    peer.on('connected', () => {
        console.log('Peer connected successfully!');
        process.exit(0);
    });
    peer.on('error', (err) => {
        console.error('Peer error:', err);
        process.exit(1);
    });

    console.log('Peer connecting to 127.0.0.1...');
    peer.connect('127.0.0.1', { handle: 'PeerUser' });
}

run().catch(console.error);
