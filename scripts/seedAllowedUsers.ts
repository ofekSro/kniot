/**
 * Writes config/allowedUsers from ALLOWED_EMAILS in .env.
 *
 *   npm run seed
 *
 * Uses the Admin SDK, which bypasses firestore.rules. That is necessary: the
 * rules make config/allowedUsers readable only to accounts already on the list,
 * so a client could never create it in the first place.
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(1)
}

const raw = process.env.ALLOWED_EMAILS
if (!raw) {
  fail('ALLOWED_EMAILS is missing from .env (comma separated list of emails).')
}

const emails = raw
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

if (emails.length === 0) {
  fail('ALLOWED_EMAILS is empty.')
}

const invalid = emails.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
if (invalid.length > 0) {
  fail(`These do not look like email addresses: ${invalid.join(', ')}`)
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!keyPath) {
  fail(
    'GOOGLE_APPLICATION_CREDENTIALS is missing from .env.\n' +
      '    Firebase Console -> Project settings -> Service accounts -> Generate new private key,\n' +
      '    save the file, and point GOOGLE_APPLICATION_CREDENTIALS at it.',
  )
}

const absKeyPath = resolve(process.cwd(), keyPath)

let serviceAccount: { project_id?: string }
try {
  serviceAccount = JSON.parse(readFileSync(absKeyPath, 'utf-8')) as {
    project_id?: string
  }
} catch {
  fail(`Could not read the service account key at ${absKeyPath}`)
}

if (!serviceAccount.project_id) {
  fail(`${absKeyPath} does not look like a Firebase service account key.`)
}

if (getApps().length === 0) {
  initializeApp({ credential: cert(absKeyPath) })
}

const db = getFirestore()

await db.doc('config/allowedUsers').set({ emails })

console.log(`\n  ✓ Wrote config/allowedUsers to project "${serviceAccount.project_id}"`)
for (const email of emails) console.log(`      • ${email}`)
console.log('')

process.exit(0)
