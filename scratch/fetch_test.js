const https = require('https');

https.get('https://sc-craft.tools/api/blueprints?page=1&limit=5&version=LIVE-4.8.0-11825000', {
    headers: { 'User-Agent': 'VerseCon-Link/1.0' }
}, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => {
        try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            console.log(JSON.stringify(data.items?.[0] || data, null, 2));
        } catch (e) {
            console.error(e);
        }
    });
}).on('error', console.error);
