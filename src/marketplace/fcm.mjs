/**
 * src/marketplace/fcm.mjs
 * محرك إرسال إشعارات الهاتف Firebase Cloud Messaging v1
 */
import { b64url } from './jwt.mjs';

let _fcmAccessToken = null;
let _fcmTokenExpiry = 0;

export async function getFcmAccessToken(serviceAccount) {
  if (_fcmAccessToken && Date.now() < _fcmTokenExpiry) {
    return _fcmAccessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = b64url(JSON.stringify({
    iss:   serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  }));

  const { createSign } = await import('node:crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${claimSet}`);
  const sig = sign.sign(serviceAccount.private_key, 'base64url');
  const jwt = `${header}.${claimSet}.${sig}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Failed to get FCM access token');

  _fcmAccessToken = tokenData.access_token;
  _fcmTokenExpiry = Date.now() + (tokenData.expires_in - 60) * 1000;
  return _fcmAccessToken;
}

export async function sendFcmPush({ fcmToken, title, body, data = {}, serviceAccount, projectId }) {
  if (!serviceAccount || !fcmToken) return { ok: false, reason: 'missing_config' };

  try {
    const accessToken = await getFcmAccessToken(serviceAccount);
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message: {
            token: fcmToken,
            notification: { title, body },
            data: Object.fromEntries(
              Object.entries(data).map(([k, v]) => [k, String(v)])
            ),
            android: {
              priority: 'high',
              notification: { sound: 'default', channel_id: 'marketplace' },
            },
          },
        }),
      }
    );
    const result = await res.json();
    return { ok: res.ok, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
