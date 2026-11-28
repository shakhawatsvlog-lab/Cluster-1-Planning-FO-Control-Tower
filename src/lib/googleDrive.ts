import { initializeApp, getApps } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const BACKUP_FOLDER_NAME = 'Alex Apparels Planning Backups';

function readFirebaseEnvConfig(): {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
} | null {
  const env = (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}) as Record<
    string,
    string | undefined
  >;
  const apiKey = (env.VITE_FIREBASE_API_KEY || '').trim();
  const projectId = (env.VITE_FIREBASE_PROJECT_ID || '').trim();
  const appId = (env.VITE_FIREBASE_APP_ID || '').trim();
  if (!apiKey || !projectId || !appId) {
    return null;
  }
  return {
    apiKey,
    authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`).trim(),
    projectId,
    storageBucket: (env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`).trim(),
    messagingSenderId: (env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
    appId,
  };
}

let cachedAuth: Auth | null | undefined;

function getFirebaseAuthInstance(): Auth | null {
  if (cachedAuth !== undefined) {
    return cachedAuth;
  }
  const config = readFirebaseEnvConfig();
  if (!config) {
    cachedAuth = null;
    return null;
  }
  try {
    const app = getApps().length > 0 ? getApps()[0] : initializeApp(config);
    cachedAuth = getAuth(app);
    onAuthStateChanged(cachedAuth, (user) => {
      if (!user) {
        memoryAccessToken = null;
      }
    });
    return cachedAuth;
  } catch {
    cachedAuth = null;
    return null;
  }
}

export function isGoogleDriveBackupConfigured(): boolean {
  return readFirebaseEnvConfig() !== null;
}

// In-memory OAuth access token cache ONLY (never localStorage or sessionStorage)
let memoryAccessToken: string | null = null;

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export function getCurrentGoogleUser(): User | null {
  const auth = getFirebaseAuthInstance();
  return auth ? auth.currentUser : null;
}

export function hasInMemoryDriveToken(): boolean {
  return Boolean(memoryAccessToken);
}

export function subscribeGoogleAuth(cb: (user: User | null) => void): () => void {
  const auth = getFirebaseAuthInstance();
  if (!auth) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      memoryAccessToken = null;
    }
    cb(user);
  });
}

export async function signInWithGoogleDrive(): Promise<{
  user: User;
  accessToken: string;
}> {
  const auth = getFirebaseAuthInstance();
  if (!auth) {
    throw new Error(
      'Google Drive Cloud Backup is disabled (no Firebase client config). Please use "Download JSON Backup" or "Download .xlsx Dashboard" instead.'
    );
  }
  const provider = new GoogleAuthProvider();
  provider.addScope(DRIVE_FILE_SCOPE);
  provider.setCustomParameters({ prompt: 'select_account' });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken ?? null;
  if (!accessToken) {
    throw new Error('Google Drive permission was not granted. Please allow Drive access and try again.');
  }
  memoryAccessToken = accessToken;
  return { user: result.user, accessToken };
}

export async function signOutGoogleDrive(): Promise<void> {
  memoryAccessToken = null;
  const auth = getFirebaseAuthInstance();
  if (auth) {
    await signOut(auth);
  }
}

async function ensureAccessToken(): Promise<string> {
  const auth = getFirebaseAuthInstance();
  if (memoryAccessToken && auth?.currentUser) {
    return memoryAccessToken;
  }
  const { accessToken } = await signInWithGoogleDrive();
  return accessToken;
}

async function driveFetch(url: string, init: RequestInit, token: string): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 || res.status === 403) {
    memoryAccessToken = null;
    throw new Error('Google Drive session expired or permission missing. Please sign in with Google again.');
  }
  return res;
}

export async function ensureBackupFolder(): Promise<{ folderId: string; token: string }> {
  const token = await ensureAccessToken();
  const q = encodeURIComponent(
    `name = '${BACKUP_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const searchRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`,
    { method: 'GET' },
    token
  );
  if (!searchRes.ok) {
    throw new Error(`Unable to inspect Google Drive folders (${searchRes.status}).`);
  }
  const searchData = (await searchRes.json()) as { files?: Array<{ id: string; name: string }> };
  if (searchData.files && searchData.files.length > 0) {
    return { folderId: searchData.files[0].id, token };
  }

  const createRes = await driveFetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: BACKUP_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    },
    token
  );
  if (!createRes.ok) {
    throw new Error(`Failed to create Google Drive backup folder (${createRes.status}).`);
  }
  const folder = (await createRes.json()) as { id: string };
  return { folderId: folder.id, token };
}

async function uploadMultipartFile(params: {
  token: string;
  folderId: string;
  name: string;
  mimeType: string;
  blob: Blob;
  existingFileId?: string;
}): Promise<DriveFileItem> {
  const { token, folderId, name, mimeType, blob, existingFileId } = params;
  const boundary = `alex_drive_boundary_${Date.now().toString(36)}`;
  const metadata = existingFileId
    ? { name, mimeType }
    : { name, mimeType, parents: [folderId] };

  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
    metadata
  )}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closingPart = `\r\n--${boundary}--`;

  const bodyBlob = new Blob([metaPart, blob, closingPart], {
    type: `multipart/related; boundary=${boundary}`,
  });

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        existingFileId
      )}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink';

  const res = await driveFetch(
    url,
    {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: bodyBlob,
    },
    token
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Google Drive upload failed (${res.status}): ${errText.slice(0, 180)}`);
  }

  return (await res.json()) as DriveFileItem;
}

export async function listDriveBackups(): Promise<DriveFileItem[]> {
  const { folderId, token } = await ensureBackupFolder();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=30&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)`,
    { method: 'GET' },
    token
  );
  if (!res.ok) {
    throw new Error(`Failed to list Google Drive backups (${res.status}).`);
  }
  const data = (await res.json()) as { files?: DriveFileItem[] };
  return data.files ?? [];
}

export async function saveBackupBundleToDrive(params: {
  snapshotJson: string;
  xlsxBlob?: Blob | null;
  overwriteFileId?: string;
}): Promise<{
  jsonFile: DriveFileItem;
  xlsxFile?: DriveFileItem;
}> {
  const { folderId, token } = await ensureBackupFolder();
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);

  const jsonFile = await uploadMultipartFile({
    token,
    folderId,
    name: `Alex_Apparels_App_State_${stamp}.json`,
    mimeType: 'application/json',
    blob: new Blob([params.snapshotJson], { type: 'application/json' }),
    existingFileId: params.overwriteFileId,
  });

  let xlsxFile: DriveFileItem | undefined;
  if (params.xlsxBlob) {
    xlsxFile = await uploadMultipartFile({
      token,
      folderId,
      name: `Alex_Apparels_Planning_${stamp}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      blob: params.xlsxBlob,
    });
  }

  return { jsonFile, xlsxFile };
}

export async function downloadDriveJsonFile(fileId: string): Promise<unknown> {
  const token = await ensureAccessToken();
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { method: 'GET' },
    token
  );
  if (!res.ok) {
    throw new Error(`Unable to download backup file from Google Drive (${res.status}).`);
  }
  return res.json();
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  const token = await ensureAccessToken();
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    { method: 'DELETE' },
    token
  );
  if (!res.ok) {
    throw new Error(`Unable to delete file from Google Drive (${res.status}).`);
  }
}
