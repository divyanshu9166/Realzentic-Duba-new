/**
 * File Upload — Local VPS Storage
 *
 * All images/files are stored on the VPS at the Docker volume mount:
 *   /app/uploads  (container path, persisted via Docker named volume)
 *
 * The UPLOAD_DIR env var is set in docker-compose.yml to "/app/uploads".
 * In local dev (no env var set), files go next to the project at
 *   ../realzentic-dubai-uploads
 *
 * Files are served back via /api/uploads/[...path]/route.ts
 */

import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'

// ─── Path Resolution ──────────────────────────────────────────────────

export function getUploadsRoot(): string {
  // UPLOAD_DIR is set in docker-compose to "/app/uploads" (the Docker volume)
  // In local dev, keep uploads outside the project so Turbopack does not try
  // to bundle/analyze every possible file under <project>/uploads.
  return (process.env.UPLOAD_DIR || `${process.cwd()}/../realzentic-dubai-uploads`)
    .replace(/[\\/]+$/, '')
}

function sanitizePathSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function sanitizeFolder(folder: string): string {
  const segments = folder
    .split(/[\\/]+/)
    .map((segment) => sanitizePathSegment(segment.trim()))
    .filter((segment) => segment && segment !== '.' && segment !== '..')

  if (segments.length === 0) return 'uploads'
  return segments.join('/')
}

export function getUploadFilePath(relativePath: string): string {
  const safeRelativePath = relativePath
    .split(/[\\/]+/)
    .map((segment) => sanitizePathSegment(segment.trim()))
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/')

  if (!safeRelativePath) {
    throw new Error('Invalid upload path')
  }

  return `${getUploadsRoot()}/${safeRelativePath}`
}

function extensionFromFileName(fileName: string): string {
  const lastPart = fileName.split(/[\\/]/).pop() || ''
  const dotIndex = lastPart.lastIndexOf('.')
  if (dotIndex < 0 || dotIndex === lastPart.length - 1) return 'bin'
  return lastPart.slice(dotIndex + 1).toLowerCase()
}

// ─── Upload ───────────────────────────────────────────────────────────

export async function uploadFile(
  file: Buffer,
  fileName: string,
  _contentType: string,   // kept for API compatibility — not used for local storage
  folder: string
): Promise<string> {
  const rawExt = extensionFromFileName(fileName)
  const ext = sanitizePathSegment(rawExt || 'bin')
  const uniqueName = `${randomUUID()}.${ext}`
  const safeFolder = sanitizeFolder(folder)
  const dir = `${getUploadsRoot()}/${safeFolder}`
  const filePath = `${dir}/${uniqueName}`

  console.log(`[Upload] Saving to: ${filePath}`)

  try {
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, file)
    console.log(`[Upload] SUCCESS: /api/uploads/${safeFolder}/${uniqueName}`)
  } catch (err) {
    console.error(`[Upload] FAILED writing ${filePath}:`, err)
    throw err
  }

  return `/api/uploads/${safeFolder}/${uniqueName}`
}

// ─── Delete ───────────────────────────────────────────────────────────

export async function deleteFile(key: string): Promise<void> {
  // key is like "/api/uploads/properties/uuid.jpg"
  const relativePath = key.replace(/^\/api\/uploads\//, '')
  const filePath = getUploadFilePath(relativePath)
  try {
    await unlink(filePath)
    console.log(`[Upload] Deleted: ${filePath}`)
  } catch {
    // File may not exist — ignore silently
  }
}

// ─── Presigned URL stub (not needed for local storage) ────────────────

export async function getPresignedUploadUrl(
  folder: string,
  fileName: string,
  _contentType: string
): Promise<{ url: string; key: string }> {
  const rawExt = extensionFromFileName(fileName)
  const ext = sanitizePathSegment(rawExt || 'bin')
  const key = `/api/uploads/${sanitizeFolder(folder)}/${randomUUID()}.${ext}`
  return { url: '/api/upload', key }
}
