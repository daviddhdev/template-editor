
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { readDotEnv } from './env'

const SCHEME = 'v1'
const SALT_LEN = 16
const IV_LEN = 12

function appSecret(): string {
  const secret = (process.env.APP_SECRET ?? readDotEnv().APP_SECRET ?? '').trim()
  if (!secret) {
    throw new Error(
      'Falta APP_SECRET en el archivo .env: es la clave para cifrar las credenciales de la API externa (mira .env.example).',
    )
  }
  return secret
}

const b64 = (b: Buffer): string => b.toString('base64url')
const unb64 = (s: string): Buffer => Buffer.from(s, 'base64url')

export function encryptSecret(plain: string): string {
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const key = scryptSync(appSecret(), salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [SCHEME, b64(salt), b64(iv), b64(tag), b64(enc)].join('.')
}

export function decryptSecret(token: string): string {
  const parts = token.split('.')
  if (parts.length !== 5 || parts[0] !== SCHEME) {
    throw new Error('Credencial cifrada con formato inválido.')
  }
  const [, salt, iv, tag, enc] = parts
  const key = scryptSync(appSecret(), unb64(salt), 32)
  const decipher = createDecipheriv('aes-256-gcm', key, unb64(iv))
  decipher.setAuthTag(unb64(tag))
  return Buffer.concat([decipher.update(unb64(enc)), decipher.final()]).toString('utf8')
}
