import { createHash, createHmac } from 'node:crypto'

const accessKey = process.env.S3_ACCESS_KEY_ID
const secretKey = process.env.S3_SECRET_ACCESS_KEY
const endpoint = process.env.S3_ENDPOINT || 'https://s3.regru.cloud'
const preferredBucket = process.env.S3_BUCKET || 'flor'
const objectKey = process.env.S3_OBJECT_KEY || 'state.json'
const regions = (process.env.S3_REGION ? [process.env.S3_REGION] : ['ru-1', 'us-east-1', 'ru-central-1', 'eu-central-1'])

if (!accessKey || !secretKey) {
  console.error('Need S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY')
  process.exit(1)
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

function encodePath(path) {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function signedHeaders({ method, url, body = '', region, extraHeaders = {} }) {
  const parsed = new URL(url)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256Hex(body)
  const headers = {
    host: parsed.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  }
  const names = Object.keys(headers).map((name) => name.toLowerCase()).sort()
  const canonicalHeaders = names.map((name) => `${name}:${String(headers[name]).trim()}\n`).join('')
  const signed = names.join(';')
  const canonicalRequest = [
    method,
    encodePath(parsed.pathname) || '/',
    parsed.search.replace(/^\?/, ''),
    canonicalHeaders,
    signed,
    payloadHash,
  ].join('\n')
  const scope = `${dateStamp}/${region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const kDate = hmac(`AWS4${secretKey}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, 's3')
  const kSigning = hmac(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`
  return headers
}

async function s3Fetch({ method, url, body = '', region, extraHeaders = {} }) {
  const headers = signedHeaders({ method, url, body, region, extraHeaders })
  const response = await fetch(url, { method, headers, body: body || undefined })
  const text = await response.text()
  return { status: response.status, ok: response.ok, text, etag: response.headers.get('etag') }
}

function parseBuckets(xml) {
  return [...xml.matchAll(/<Name>([^<]+)<\/Name>/g)].map((match) => match[1])
}

async function findRegionAndBuckets() {
  const errors = []
  for (const region of regions) {
    const result = await s3Fetch({ method: 'GET', url: `${endpoint}/`, region })
    if (result.ok) {
      return { region, buckets: parseBuckets(result.text), listOk: true }
    }
    errors.push(`${region}: ${result.status} ${result.text.slice(0, 180)}`)
  }
  return { region: null, buckets: [], listOk: false, errors }
}

const emptyState = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  players: [],
  matches: [],
  settings: { id: 'main', periodMinutes: 10, soundEnabled: true },
})

const corsXml = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>https://etotimoxa.github.io</AllowedOrigin>
    <AllowedOrigin>http://localhost:5173</AllowedOrigin>
    <AllowedOrigin>http://127.0.0.1:5173</AllowedOrigin>
    <AllowedOrigin>http://localhost:4173</AllowedOrigin>
    <AllowedOrigin>http://127.0.0.1:4173</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`

const found = await findRegionAndBuckets()
console.log(JSON.stringify({ list: found }, null, 2))

let region = found.region
let bucket = found.buckets.includes(preferredBucket) ? preferredBucket : found.buckets[0]
const candidateBuckets = [...new Set([preferredBucket, 'floorboll', 'flor', 'floorball', 'tur-setka', ...found.buckets])]

if (!region) {
  for (const guessRegion of regions) {
    for (const guessBucket of candidateBuckets) {
      const probe = await s3Fetch({
        method: 'GET',
        url: `${endpoint}/${guessBucket}?location=`,
        region: guessRegion,
      })
      if (probe.ok || probe.status === 404 || probe.status === 301 || (probe.status === 403 && !probe.text.includes('SignatureDoesNotMatch'))) {
        region = guessRegion
        bucket = guessBucket
        console.log(`bucket probe ${guessBucket} @ ${guessRegion}: ${probe.status}`)
        break
      }
    }
    if (region) break
  }
}

if (!region) {
  console.error('Could not sign S3 requests with these keys/regions')
  process.exit(1)
}

if (!found.buckets.includes(preferredBucket)) {
  const created = await s3Fetch({
    method: 'PUT',
    url: `${endpoint}/${preferredBucket}`,
    region,
    extraHeaders: { 'content-type': 'application/xml' },
  })
  console.log(`create ${preferredBucket}: ${created.status} ${created.text.slice(0, 240)}`)
  if (created.ok || created.status === 409) bucket = preferredBucket
}

if (!bucket) bucket = preferredBucket

const cors = await s3Fetch({
  method: 'PUT',
  url: `${endpoint}/${bucket}?cors=`,
  region,
  body: corsXml,
  extraHeaders: { 'content-type': 'application/xml' },
})
console.log(`cors: ${cors.status} ${cors.text.slice(0, 240)}`)

const objectUrl = `${endpoint}/${bucket}/${objectKey}`
const current = await s3Fetch({ method: 'GET', url: objectUrl, region })
console.log(`get state: ${current.status}`)
if (!current.ok) {
  const put = await s3Fetch({
    method: 'PUT',
    url: objectUrl,
    region,
    body: emptyState,
    extraHeaders: {
      'content-type': 'application/json',
      'x-amz-acl': 'public-read',
    },
  })
  console.log(`put empty state: ${put.status} ${put.text.slice(0, 240)}`)
}

const acl = await s3Fetch({
  method: 'PUT',
  url: `${objectUrl}?acl=`,
  region,
  extraHeaders: { 'x-amz-acl': 'public-read' },
})
console.log(`acl public-read: ${acl.status} ${acl.text.slice(0, 240)}`)

const anon = await fetch(objectUrl)
console.log(`anonymous get: ${anon.status}`)

console.log(JSON.stringify({
  ok: true,
  endpoint,
  region,
  bucket,
  objectKey,
  objectUrl,
}, null, 2))
