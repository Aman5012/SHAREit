
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const PIN = process.argv[2];
if (!PIN) { console.error("Please provide PIN as argument"); process.exit(1); }

const TEST_FILE = 'test_payload.txt';
fs.writeFileSync(TEST_FILE, 'This is a secure test file.');

function uploadFile(pin, hash, filename, label) {
    return new Promise((resolve) => {
        const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
        const content = fs.readFileSync(TEST_FILE);

        let body = `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="files"; filename="${filename}"\r\n`;
        body += `Content-Type: text/plain\r\n\r\n`;
        body += content;
        body += `\r\n--${boundary}--`;

        const options = {
            hostname: 'localhost',
            port: 9000,
            path: '/api/upload',
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'x-passcode': pin
            }
        };

        if (hash) options.headers['x-file-hash'] = hash;

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                console.log(`[${label}] Status: ${res.statusCode} | Body: ${data}`);
                resolve(res.statusCode);
            });
        });

        req.on('error', (e) => {
            console.log(`[${label}] Failed: ${e.message}`);
            resolve(500);
        });

        req.write(body);
        req.end();
    });
}

async function run() {
    // 1. Wrong PIN
    await uploadFile('000000', null, 'wrong_pin.txt', 'TEST 1: Wrong PIN');

    // 2. Correct PIN, No Hash (Should Upload but Unverified)
    await uploadFile(PIN, null, 'no_hash.txt', 'TEST 2: Correct PIN, No Hash');

    // 3. Correct PIN, Bad Hash
    await uploadFile(PIN, 'badhash123', 'bad_hash.txt', 'TEST 3: Bad Hash');

    // 4. Correct PIN, Good Hash
    const sum = crypto.createHash('sha256');
    sum.update(fs.readFileSync(TEST_FILE));
    const goodHash = sum.digest('hex');
    await uploadFile(PIN, goodHash, 'good_hash.txt', 'TEST 4: Good Hash');
}

run();
