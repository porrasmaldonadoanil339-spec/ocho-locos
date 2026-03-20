import { Router } from "express";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const router = Router();

const USERS_FILE = path.join("/tmp", "ocho_users.json");

interface User {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  googleId?: string;
  facebookId?: string;
  stats?: {
    wins: number;
    gamesPlayed: number;
    xp: number;
    coins: number;
  };
}

interface TokenPayload {
  userId: string;
  username: string;
  iat: number;
  exp: number;
}

function loadUsers(): User[] {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    }
  } catch {}
  return [];
}

function saveUsers(users: User[]) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
}

function generateToken(userId: string, username: string): string {
  const payload: TokenPayload = {
    userId,
    username,
    iat: Date.now(),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };
  const data = JSON.stringify(payload);
  const secret = process.env.SESSION_SECRET || "ocho-locos-secret-2024";
  const sig = crypto.createHmac("sha256", secret).update(data).digest("hex");
  return Buffer.from(data).toString("base64") + "." + sig;
}

function verifyToken(token: string): TokenPayload | null {
  try {
    const [dataB64, sig] = token.split(".");
    if (!dataB64 || !sig) return null;
    const data = Buffer.from(dataB64, "base64").toString("utf8");
    const secret = process.env.SESSION_SECRET || "ocho-locos-secret-2024";
    const expected = crypto.createHmac("sha256", secret).update(data).digest("hex");
    if (sig !== expected) return null;
    const payload = JSON.parse(data) as TokenPayload;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── POST /api/auth/register ─────────────────────────────────────────────────
router.post("/register", (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    return res.status(400).json({ error: "username and password required" });
  }
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: "Username must be 3-20 characters" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  const users = loadUsers();
  const exists = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: "Username already taken" });
  }

  const salt = crypto.randomBytes(32).toString("hex");
  const passwordHash = hashPassword(password, salt);
  const id = crypto.randomBytes(16).toString("hex");

  const newUser: User = {
    id,
    username,
    passwordHash,
    salt,
    createdAt: new Date().toISOString(),
    stats: { wins: 0, gamesPlayed: 0, xp: 0, coins: 100 },
  };
  users.push(newUser);
  saveUsers(users);

  const token = generateToken(id, username);
  return res.json({ ok: true, token, user: { id, username } });
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post("/login", (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    return res.status(400).json({ error: "username and password required" });
  }

  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const hash = hashPassword(password, user.salt);
  if (hash !== user.passwordHash) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = generateToken(user.id, user.username);
  return res.json({ ok: true, token, user: { id: user.id, username: user.username } });
});

// ─── POST /api/auth/verify ────────────────────────────────────────────────────
router.post("/verify", (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: "token required" });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "invalid or expired token" });
  return res.json({ ok: true, user: { id: payload.userId, username: payload.username } });
});

// ─── POST /api/auth/google ────────────────────────────────────────────────────
router.post("/google", async (req, res) => {
  const { accessToken, idToken } = req.body as { accessToken?: string; idToken?: string };
  const token = idToken || accessToken;
  if (!token) return res.status(400).json({ error: "token required" });

  try {
    const resp = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken || idToken}` },
    });
    if (!resp.ok) {
      return res.status(401).json({ error: "invalid Google token" });
    }
    const gUser = await resp.json() as { sub: string; name: string; email: string; picture?: string };

    const users = loadUsers();
    let user = users.find(u => u.googleId === gUser.sub);

    if (!user) {
      let username = gUser.name?.replace(/[^a-zA-Z0-9_]/g, "").substring(0, 18) || "Player";
      let base = username;
      let counter = 1;
      while (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
        username = `${base}${counter++}`;
      }

      const id = crypto.randomBytes(16).toString("hex");
      user = {
        id,
        username,
        passwordHash: "",
        salt: "",
        createdAt: new Date().toISOString(),
        googleId: gUser.sub,
        stats: { wins: 0, gamesPlayed: 0, xp: 0, coins: 100 },
      };
      users.push(user);
      saveUsers(users);
    }

    const authToken = generateToken(user.id, user.username);
    return res.json({ ok: true, token: authToken, user: { id: user.id, username: user.username } });
  } catch (e) {
    return res.status(500).json({ error: "Google auth failed" });
  }
});

// ─── POST /api/auth/facebook ──────────────────────────────────────────────────
router.post("/facebook", async (req, res) => {
  const { accessToken } = req.body as { accessToken?: string };
  if (!accessToken) return res.status(400).json({ error: "accessToken required" });

  try {
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appId || !appSecret) {
      return res.status(503).json({ error: "Facebook not configured" });
    }

    const appTokenResp = await fetch(`https://graph.facebook.com/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&grant_type=client_credentials`);
    const appTokenData = await appTokenResp.json() as { access_token: string };

    const verifyResp = await fetch(`https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${appTokenData.access_token}`);
    const verifyData = await verifyResp.json() as { data: { is_valid: boolean; user_id: string } };
    if (!verifyData.data?.is_valid) {
      return res.status(401).json({ error: "invalid Facebook token" });
    }

    const meResp = await fetch(`https://graph.facebook.com/me?fields=id,name&access_token=${accessToken}`);
    const fbUser = await meResp.json() as { id: string; name: string };

    const users = loadUsers();
    let user = users.find(u => u.facebookId === fbUser.id);

    if (!user) {
      let username = fbUser.name?.replace(/[^a-zA-Z0-9_]/g, "").substring(0, 18) || "Player";
      let base = username;
      let counter = 1;
      while (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
        username = `${base}${counter++}`;
      }
      const id = crypto.randomBytes(16).toString("hex");
      user = {
        id,
        username,
        passwordHash: "",
        salt: "",
        createdAt: new Date().toISOString(),
        facebookId: fbUser.id,
        stats: { wins: 0, gamesPlayed: 0, xp: 0, coins: 100 },
      };
      users.push(user);
      saveUsers(users);
    }

    const authToken = generateToken(user.id, user.username);
    return res.json({ ok: true, token: authToken, user: { id: user.id, username: user.username } });
  } catch {
    return res.status(500).json({ error: "Facebook auth failed" });
  }
});

// ─── GET /api/auth/google/start ──────────────────────────────────────────────
router.get("/google/start", (req, res) => {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(503).send(`
      <html><body style="font-family:sans-serif;background:#041008;color:#D4AF37;text-align:center;padding:40px">
        <h2>Google OAuth No Configurado</h2>
        <p style="color:#aaa">Agrega <b>EXPO_PUBLIC_GOOGLE_CLIENT_ID</b> y <b>GOOGLE_CLIENT_SECRET</b> en los Secrets de Replit</p>
        <p style="color:#888;font-size:12px">Crea las credenciales en <a href="https://console.cloud.google.com" style="color:#4A90E2">Google Cloud Console</a></p>
      </body></html>
    `);
  }

  const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
  const state = crypto.randomBytes(16).toString("hex");
  const scope = "openid profile email";
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}&access_type=offline`;

  return res.redirect(url);
});

// ─── GET /api/auth/google/callback ───────────────────────────────────────────
router.get("/google/callback", async (req, res) => {
  const { code, error: oauthError } = req.query as Record<string, string>;
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

  if (oauthError || !code) {
    return sendOAuthResult(res, null, "Google auth cancelled");
  }

  if (!clientId || !clientSecret) {
    return sendOAuthResult(res, null, "Google not configured");
  }

  try {
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const tokenData = await tokenResp.json() as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      return sendOAuthResult(res, null, tokenData.error || "No access token");
    }

    const userResp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const gUser = await userResp.json() as { sub: string; name: string; email: string };

    const users = loadUsers();
    let user = users.find(u => u.googleId === gUser.sub);
    if (!user) {
      let username = gUser.name?.replace(/[^a-zA-Z0-9_]/g, "").substring(0, 18) || "Player";
      let base = username; let counter = 1;
      while (users.find(u => u.username.toLowerCase() === username.toLowerCase())) { username = `${base}${counter++}`; }
      const id = crypto.randomBytes(16).toString("hex");
      user = { id, username, passwordHash: "", salt: "", createdAt: new Date().toISOString(), googleId: gUser.sub, stats: { wins: 0, gamesPlayed: 0, xp: 0, coins: 100 } };
      users.push(user); saveUsers(users);
    }

    const token = generateToken(user.id, user.username);
    return sendOAuthResult(res, token, null);
  } catch (e) {
    return sendOAuthResult(res, null, "Google auth failed");
  }
});

// ─── GET /api/auth/facebook/start ────────────────────────────────────────────
router.get("/facebook/start", (req, res) => {
  const appId = process.env.FACEBOOK_APP_ID || process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;
  if (!appId) {
    return res.status(503).send(`
      <html><body style="font-family:sans-serif;background:#041008;color:#D4AF37;text-align:center;padding:40px">
        <h2>Facebook OAuth No Configurado</h2>
        <p style="color:#aaa">Agrega <b>FACEBOOK_APP_ID</b> y <b>FACEBOOK_APP_SECRET</b> en los Secrets de Replit</p>
      </body></html>
    `);
  }

  const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/facebook/callback`;
  const url = `https://www.facebook.com/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=public_profile&response_type=code`;
  return res.redirect(url);
});

// ─── GET /api/auth/facebook/callback ─────────────────────────────────────────
router.get("/facebook/callback", async (req, res) => {
  const { code, error: oauthError } = req.query as Record<string, string>;
  const appId = process.env.FACEBOOK_APP_ID || process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/facebook/callback`;

  if (oauthError || !code) return sendOAuthResult(res, null, "Facebook auth cancelled");
  if (!appId || !appSecret) return sendOAuthResult(res, null, "Facebook not configured");

  try {
    const tokenResp = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`);
    const tokenData = await tokenResp.json() as { access_token?: string };
    if (!tokenData.access_token) return sendOAuthResult(res, null, "No access token");

    const meResp = await fetch(`https://graph.facebook.com/me?fields=id,name&access_token=${tokenData.access_token}`);
    const fbUser = await meResp.json() as { id: string; name: string };

    const users = loadUsers();
    let user = users.find(u => u.facebookId === fbUser.id);
    if (!user) {
      let username = fbUser.name?.replace(/[^a-zA-Z0-9_]/g, "").substring(0, 18) || "Player";
      let base = username; let counter = 1;
      while (users.find(u => u.username.toLowerCase() === username.toLowerCase())) { username = `${base}${counter++}`; }
      const id = crypto.randomBytes(16).toString("hex");
      user = { id, username, passwordHash: "", salt: "", createdAt: new Date().toISOString(), facebookId: fbUser.id, stats: { wins: 0, gamesPlayed: 0, xp: 0, coins: 100 } };
      users.push(user); saveUsers(users);
    }

    const token = generateToken(user.id, user.username);
    return sendOAuthResult(res, token, null);
  } catch {
    return sendOAuthResult(res, null, "Facebook auth failed");
  }
});

function sendOAuthResult(res: import("express").Response, token: string | null, error: string | null) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>OCHO LOCOS - Auth</title>
  <style>
    body { font-family: sans-serif; background: #041008; color: #D4AF37; text-align: center; padding: 40px; }
    h2 { font-size: 24px; }
    p { color: #aaa; }
  </style>
</head>
<body>
  <h2>OCHO LOCOS</h2>
  ${error
    ? `<p style="color:#E74C3C">Error: ${error}</p><script>
        if (window.opener) { window.opener.postMessage({type:'OAUTH_ERROR',error:'${error}'},'*'); window.close(); }
        else { setTimeout(() => window.location.href = '/login', 2000); }
      </script>`
    : `<p style="color:#27AE60">¡Autenticación exitosa! Volviendo al juego...</p>
       <script>
        const token = '${token}';
        if (window.opener) { window.opener.postMessage({type:'OAUTH_SUCCESS',token},'*'); window.close(); }
        else if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(JSON.stringify({type:'OAUTH_SUCCESS',token})); }
        else { window.location.href = 'myapp://oauth?token=' + token; }
      </script>`
  }
</body>
</html>`;
  return res.send(html);
}

// ─── Reset tokens storage ─────────────────────────────────────────────────────
const RESET_TOKENS_FILE = path.join("/tmp", "ocho_reset_tokens.json");
interface ResetToken { userId: string; token: string; expires: number; }

function loadResetTokens(): ResetToken[] {
  try {
    if (fs.existsSync(RESET_TOKENS_FILE)) return JSON.parse(fs.readFileSync(RESET_TOKENS_FILE, "utf8"));
  } catch {}
  return [];
}
function saveResetTokens(tokens: ResetToken[]) {
  fs.writeFileSync(RESET_TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post("/forgot-password", (req, res) => {
  const { username } = req.body as { username?: string };
  if (!username) return res.status(400).json({ error: "username required" });

  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

  const tokens = loadResetTokens().filter(t => t.expires > Date.now());
  if (user) {
    const resetToken = crypto.randomBytes(32).toString("hex");
    tokens.push({ userId: user.id, token: resetToken, expires: Date.now() + 15 * 60 * 1000 });
    saveResetTokens(tokens);
  }

  return res.json({ ok: true, message: "Si el usuario existe, recibirás instrucciones para restablecer tu contraseña." });
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
router.post("/reset-password", (req, res) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  if (!token || !newPassword) return res.status(400).json({ error: "token and newPassword required" });
  if (newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const tokens = loadResetTokens().filter(t => t.expires > Date.now());
  const resetEntry = tokens.find(t => t.token === token);
  if (!resetEntry) return res.status(400).json({ error: "Invalid or expired token" });

  const users = loadUsers();
  const user = users.find(u => u.id === resetEntry.userId);
  if (!user) return res.status(400).json({ error: "User not found" });

  const salt = crypto.randomBytes(32).toString("hex");
  user.passwordHash = hashPassword(newPassword, salt);
  user.salt = salt;
  saveUsers(users);
  saveResetTokens(tokens.filter(t => t.token !== token));

  return res.json({ ok: true, message: "Password reset successfully" });
});

// ─── Profile cloud save storage ───────────────────────────────────────────────
const PROFILES_FILE = path.join("/tmp", "ocho_profiles.json");
interface CloudProfile { userId: string; data: Record<string, unknown>; updatedAt: string; }

function loadProfiles(): CloudProfile[] {
  try {
    if (fs.existsSync(PROFILES_FILE)) return JSON.parse(fs.readFileSync(PROFILES_FILE, "utf8"));
  } catch {}
  return [];
}
function saveProfiles(profiles: CloudProfile[]) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

// ─── GET /api/profile ─────────────────────────────────────────────────────────
router.get("/profile", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  const token = auth.replace("Bearer ", "");
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  const profiles = loadProfiles();
  const profile = profiles.find(p => p.userId === payload.userId);
  if (!profile) return res.json({ ok: true, data: null });
  return res.json({ ok: true, data: profile.data, updatedAt: profile.updatedAt });
});

// ─── POST /api/profile ────────────────────────────────────────────────────────
router.post("/profile", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  const token = auth.replace("Bearer ", "");
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  const { data } = req.body as { data?: Record<string, unknown> };
  if (!data) return res.status(400).json({ error: "data required" });

  const profiles = loadProfiles();
  const idx = profiles.findIndex(p => p.userId === payload.userId);
  const entry: CloudProfile = { userId: payload.userId, data, updatedAt: new Date().toISOString() };
  if (idx >= 0) profiles[idx] = entry; else profiles.push(entry);
  saveProfiles(profiles);

  return res.json({ ok: true });
});

export default router;
