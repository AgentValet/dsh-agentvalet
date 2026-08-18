import { generateKeyPair } from 'node:crypto'
import { promisify } from 'node:util'

const generate = promisify(generateKeyPair)

export interface AgentKeypair {
  publicKeyPem: string
  privateKeyPem: string
}

/**
 * RS256 keypair for one dsh profile. The private half never leaves this
 * machine — only `publicKeyPem` is sent to AgentValet.
 */
export async function generateAgentKeypair(): Promise<AgentKeypair> {
  const { publicKey, privateKey } = await generate('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKeyPem: publicKey as string, privateKeyPem: privateKey as string }
}
