import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import { encryptBlob, decryptBlob, generateSalt, hashPin } from '../auth/crypto'

const DB_NAME = 'cise_student_records'
const isNative = Capacitor.isNativePlatform()

// The encryption secret protects the SQLite file at rest on the device
// (SQLCipher, via @capacitor-community/sqlite's native encryption support).
// It must NOT be hardcoded in a shipped app — see README "Before you ship"
// for how to source this from Android Keystore instead.
const ENCRYPTION_SECRET = import.meta.env.VITE_DB_SECRET || 'CHANGE_ME_BEFORE_SHIPPING'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  pinHash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('director','teacher')),
  assignedClass TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  firstName TEXT NOT NULL,
  lastName TEXT NOT NULL,
  dob TEXT,
  gender TEXT,
  grade TEXT,
  className TEXT,
  photoUri TEXT,
  guardianName TEXT,
  guardianPhone TEXT,
  guardianEmail TEXT,
  emergencyContactName TEXT,
  emergencyContactPhone TEXT,
  medicalNotes TEXT,
  address TEXT,
  enrollmentDate TEXT,
  isArchived INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  userId TEXT,
  username TEXT,
  action TEXT NOT NULL,
  targetType TEXT,
  targetId TEXT,
  details TEXT,
  timestamp TEXT NOT NULL
);
`

let sqlite = null
let db = null

// ---------- Web preview fallback (dev only) ----------
// Not for production data. Real devices must use the native path below,
// where SQLCipher provides actual file-level encryption at rest.
const WEB_STORE_KEY = 'cise_web_store_v1'
let webStore = null

function loadWebStore() {
  if (webStore) return webStore
  const raw = localStorage.getItem(WEB_STORE_KEY)
  if (raw) {
    try {
      webStore = decryptBlob(raw, ENCRYPTION_SECRET) || { users: [], students: [], audit_log: [] }
    } catch {
      webStore = { users: [], students: [], audit_log: [] }
    }
  } else {
    webStore = { users: [], students: [], audit_log: [] }
  }
  return webStore
}

function saveWebStore() {
  const cipherText = encryptBlob(webStore, ENCRYPTION_SECRET)
  localStorage.setItem(WEB_STORE_KEY, cipherText)
}

// ---------- Public API ----------

export async function initDatabase() {
  if (isNative) {
    sqlite = new SQLiteConnection(CapacitorSQLite)

    // The global encryption secret MUST be registered before an encrypted
    // ("secret" mode) connection is created or opened, otherwise the native
    // layer throws "No Passphrase stored". Only set it once — check first.
    const secretStored = await sqlite.isSecretStored()
    if (!secretStored.result) {
      await sqlite.setEncryptionSecret(ENCRYPTION_SECRET)
    }

    const ret = await sqlite.checkConnectionsConsistency()
    const isConn = (await sqlite.isConnection(DB_NAME, false)).result
    if (ret.result && isConn) {
      db = await sqlite.retrieveConnection(DB_NAME, false)
    } else {
      db = await sqlite.createConnection(DB_NAME, true, 'secret', 1, false)
    }
    await db.open()
    await db.execute(SCHEMA)
  } else {
    loadWebStore()
  }
  await seedDirectorIfEmpty()
}

async function seedDirectorIfEmpty() {
  const users = await getUsers()
  if (users.length === 0) {
    // First-run bootstrap only. The director sets a real PIN on first login
    // and should change it immediately (see Settings > Change PIN).
    await createUser({
      name: 'Director',
      username: 'director',
      pin: '0000',
      role: 'director',
      assignedClass: null,
    })
  }
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// ---- Users ----
export async function getUsers() {
  if (isNative) {
    const res = await db.query('SELECT * FROM users')
    return res.values || []
  }
  return loadWebStore().users
}

export async function getUserByUsername(username) {
  const users = await getUsers()
  return users.find(u => u.username === username) || null
}

export async function createUser({ name, username, pin, role, assignedClass }) {
  const salt = generateSalt()
  const pinHash = hashPin(pin, salt)
  const user = {
    id: uid(),
    name,
    username,
    pinHash,
    salt,
    role,
    assignedClass: assignedClass || null,
    active: 1,
    createdAt: new Date().toISOString(),
  }
  if (isNative) {
    await db.run(
      `INSERT INTO users (id,name,username,pinHash,salt,role,assignedClass,active,createdAt) VALUES (?,?,?,?,?,?,?,?,?)`,
      [user.id, user.name, user.username, user.pinHash, user.salt, user.role, user.assignedClass, user.active, user.createdAt]
    )
  } else {
    const store = loadWebStore()
    store.users.push(user)
    saveWebStore()
  }
  return user
}

export async function updateUserPin(userId, newPinHash) {
  if (isNative) {
    await db.run('UPDATE users SET pinHash = ? WHERE id = ?', [newPinHash, userId])
  } else {
    const store = loadWebStore()
    const idx = store.users.findIndex(u => u.id === userId)
    if (idx >= 0) {
      store.users[idx].pinHash = newPinHash
      saveWebStore()
    }
  }
}

// ---- Students ----
export async function getStudents({ role, assignedClass, includeArchived = false } = {}) {
  let rows
  if (isNative) {
    const res = await db.query('SELECT * FROM students')
    rows = res.values || []
  } else {
    rows = loadWebStore().students
  }
  let filtered = includeArchived ? rows : rows.filter(s => !s.isArchived)
  // Role-based access: teachers only see students in their assigned class.
  if (role === 'teacher' && assignedClass) {
    filtered = filtered.filter(s => s.className === assignedClass)
  }
  return filtered
}

export async function getStudentById(id) {
  const students = await getStudents({ includeArchived: true })
  return students.find(s => s.id === id) || null
}

export async function addStudent(data) {
  const now = new Date().toISOString()
  const student = { id: uid(), isArchived: 0, createdAt: now, updatedAt: now, ...data }
  if (isNative) {
    const cols = Object.keys(student)
    const placeholders = cols.map(() => '?').join(',')
    await db.run(
      `INSERT INTO students (${cols.join(',')}) VALUES (${placeholders})`,
      cols.map(c => student[c])
    )
  } else {
    const store = loadWebStore()
    store.students.push(student)
    saveWebStore()
  }
  return student
}

export async function updateStudent(id, updates) {
  const now = new Date().toISOString()
  if (isNative) {
    const cols = Object.keys(updates)
    const setClause = cols.map(c => `${c} = ?`).join(', ')
    await db.run(`UPDATE students SET ${setClause}, updatedAt = ? WHERE id = ?`, [...cols.map(c => updates[c]), now, id])
  } else {
    const store = loadWebStore()
    const idx = store.students.findIndex(s => s.id === id)
    if (idx >= 0) {
      store.students[idx] = { ...store.students[idx], ...updates, updatedAt: now }
      saveWebStore()
    }
  }
}

// Soft-delete only — preserves an audit trail. Records are archived, not
// destroyed, so a mistaken removal (or a records request) can be recovered.
export async function archiveStudent(id) {
  await updateStudent(id, { isArchived: 1 })
}

export async function restoreStudent(id) {
  await updateStudent(id, { isArchived: 0 })
}

// ---- Audit log ----
export async function addAuditLog({ userId, username, action, targetType, targetId, details }) {
  const entry = {
    id: uid(),
    userId: userId || null,
    username: username || 'unknown',
    action,
    targetType: targetType || null,
    targetId: targetId || null,
    details: details || '',
    timestamp: new Date().toISOString(),
  }
  if (isNative) {
    await db.run(
      `INSERT INTO audit_log (id,userId,username,action,targetType,targetId,details,timestamp) VALUES (?,?,?,?,?,?,?,?)`,
      [entry.id, entry.userId, entry.username, entry.action, entry.targetType, entry.targetId, entry.details, entry.timestamp]
    )
  } else {
    const store = loadWebStore()
    store.audit_log.push(entry)
    saveWebStore()
  }
  return entry
}

export async function getAuditLog({ limit = 200 } = {}) {
  let rows
  if (isNative) {
    const res = await db.query('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?', [limit])
    rows = res.values || []
  } else {
    rows = [...loadWebStore().audit_log].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit)
  }
  return rows
}
