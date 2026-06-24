#!/usr/bin/env node
// Download all card images and upload to Cloudflare R2

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cards.json'), 'utf8'));
const r2Config = JSON.parse(fs.readFileSync(path.join(process.env.HOME, 'projects', 'akile-monitor', 'r2.json'), 'utf8'));

const IMG_DIR = path.join(__dirname, '..', 'public', 'cards');
const CONCURRENCY = 8;
const R2_BUCKET = r2Config.bucket;
const R2_PUBLIC = 'https://pub-42ef6b8e7b1c4f22a42d1b89e3a3b556.r2.dev'; // zutomayo-gallery-archive public URL

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${r2Config.account_id}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: r2Config.access_key,
    secretAccessKey: r2Config.secret_key,
  },
});

fs.mkdirSync(IMG_DIR, { recursive: true });

// Download a single image
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Referer': 'https://zutomayocard.net/' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        download(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err) => { fs.unlinkSync(dest); reject(err); });
    }).on('error', (err) => { fs.unlinkSync(dest); reject(err); });
  });
}

// Upload to R2
async function uploadToR2(localPath, r2Key) {
  const body = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
    Body: body,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=31536000',
  }));
}

// Process one card
async function processCard(card) {
  const url = card.image;
  const filename = url.split('/').pop();
  const pack = card.pack.toLowerCase().replace(/\s+/g, '-');
  const localPath = path.join(IMG_DIR, filename);
  const r2Key = `cards/${pack}/${filename}`;

  // Download if not exists
  if (!fs.existsSync(localPath) || fs.statSync(localPath).size < 1000) {
    await download(url, localPath);
    process.stdout.write(`[dl] `);
  }

  // Upload to R2
  await uploadToR2(localPath, r2Key);
  process.stdout.write(`.`);

  return { r2Key, localPath };
}

// Process in batches
async function main() {
  console.log(`Downloading ${cards.length} card images...`);
  console.log(`R2 bucket: ${R2_BUCKET}`);
  console.log(`Local dir: ${IMG_DIR}\n`);

  let done = 0;
  let errors = 0;

  for (let i = 0; i < cards.length; i += CONCURRENCY) {
    const batch = cards.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(c => processCard(c)));
    done += results.filter(r => r.status === 'fulfilled').length;
    errors += results.filter(r => r.status === 'rejected').length;
    process.stdout.write(` (${done}/${cards.length})\n`);
  }

  const downloaded = fs.readdirSync(IMG_DIR).filter(f => f.endsWith('.jpg')).length;
  console.log(`\nDone! ${downloaded} images downloaded, ${errors} errors.`);
  console.log(`R2 base URL: ${R2_PUBLIC}/cards/`);
}

main().catch(console.error);
