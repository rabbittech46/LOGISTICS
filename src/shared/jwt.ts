import jwt from 'jsonwebtoken';
import { config } from './config.js';
import type { JwtPayload } from './types.js';

const JWT_ISSUER = 'rabbittech-logistics';
const JWT_AUDIENCE = 'logistics-api';

type JwtClaims = Omit<JwtPayload, 'iat' | 'exp'>;

function getTokenKeyId(token: string): string | undefined {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded !== 'object') {
    return undefined;
  }

  const keyId = (decoded as { header?: { kid?: unknown } }).header?.kid;
  return typeof keyId === 'string' && keyId.length > 0 ? keyId : undefined;
}

function resolveVerificationKey(token: string): string {
  const keyId = getTokenKeyId(token);
  if (keyId) {
    const matchedKey = config.jwtVerificationKeys[keyId];
    if (!matchedKey) {
      throw new jwt.JsonWebTokenError(`Unknown JWT key id: ${keyId}`);
    }
    return matchedKey;
  }

  return config.jwtDefaultVerificationKey;
}

export function signAccessToken(payload: JwtClaims): string {
  const privateKey = config.jwtSigningKeys[config.jwtActiveKid];
  if (!privateKey) {
    throw new Error(`FATAL: Missing active JWT private key for kid ${config.jwtActiveKid}`);
  }

  return jwt.sign(payload, privateKey, {
    algorithm: config.jwtAlgorithm,
    expiresIn: config.jwtExpiresIn,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    header: { alg: config.jwtAlgorithm, kid: config.jwtActiveKid },
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, resolveVerificationKey(token), {
    algorithms: [config.jwtAlgorithm],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }) as JwtPayload;
}