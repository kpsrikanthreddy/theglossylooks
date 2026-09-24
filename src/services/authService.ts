/**
 * Secure Authentication & Role-Based Access Control Service
 * Web Crypto PBKDF2-SHA256 password hashing.
 * Zero hardcoded passwords or credentials in source code.
 */

import { AdminRole, AdminUser, AdminSession } from '../types/admin';

const USERS_STORAGE_KEY = 'glossy_admin_users_v1';
const PASSWORDS_STORAGE_KEY = 'glossy_admin_hashes_v1';
const SESSION_STORAGE_KEY = 'glossy_admin_session_v1';

// Web Crypto PBKDF2 Password Hashing
async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const encoder = new TextEncoder();
  const salt = saltHex 
    ? new Uint8Array(saltHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)))
    : window.crypto.getRandomValues(new Uint8Array(16));
  
  const saltHexStr = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  const derivedKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const exportedKey = await window.crypto.subtle.exportKey('raw', derivedKey);
  const hashHex = Array.from(new Uint8Array(exportedKey)).map(b => b.toString(16).padStart(2, '0')).join('');

  return { hash: hashHex, salt: saltHexStr };
}

// Generate random secure session token
function generateToken(): string {
  const bytes = window.crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Check if any admin users exist
export function isFirstTimeSetupRequired(): boolean {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (!raw) return true;
    const users: AdminUser[] = JSON.parse(raw);
    return !users || users.length === 0;
  } catch {
    return true;
  }
}

// Get all admin users (for user management)
export function getAdminUsers(): AdminUser[] {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Register first SALON_ADMIN user (called during setup)
export async function setupFirstAdminUser(data: {
  name: string;
  email: string;
  phone?: string;
  password: string;
}): Promise<AdminSession> {
  const users = getAdminUsers();
  if (users.length > 0) {
    throw new Error('Initial admin user is already configured. Please log in.');
  }

  const { hash, salt } = await hashPassword(data.password);
  const userId = 'usr-' + Date.now();

  const newAdmin: AdminUser = {
    id: userId,
    name: data.name.trim(),
    email: data.email.toLowerCase().trim(),
    role: 'SALON_ADMIN',
    phone: data.phone?.trim() || '',
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
  };

  const usersList = [newAdmin];
  const hashesMap: Record<string, { hash: string; salt: string }> = {
    [newAdmin.email]: { hash, salt }
  };

  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(usersList));
  localStorage.setItem(PASSWORDS_STORAGE_KEY, JSON.stringify(hashesMap));

  const session: AdminSession = {
    token: generateToken(),
    user: newAdmin,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  };

  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

// Create an additional staff / receptionist / admin user
export async function createAdminUser(
  currentUser: AdminUser,
  userData: {
    name: string;
    email: string;
    phone?: string;
    role: AdminRole;
    password: string;
    assignedStaffId?: string;
  }
): Promise<AdminUser> {
  if (currentUser.role !== 'SUPER_ADMIN' && currentUser.role !== 'SALON_ADMIN') {
    throw new Error('Unauthorized: Only Salon Admins can create new staff users.');
  }

  const users = getAdminUsers();
  const cleanEmail = userData.email.toLowerCase().trim();

  if (users.some(u => u.email === cleanEmail)) {
    throw new Error('A user with this email address already exists.');
  }

  const { hash, salt } = await hashPassword(userData.password);
  const newUser: AdminUser = {
    id: 'usr-' + Date.now(),
    name: userData.name.trim(),
    email: cleanEmail,
    role: userData.role,
    phone: userData.phone?.trim() || '',
    assignedStaffId: userData.assignedStaffId,
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));

  try {
    const rawHashes = localStorage.getItem(PASSWORDS_STORAGE_KEY);
    const hashesMap = rawHashes ? JSON.parse(rawHashes) : {};
    hashesMap[cleanEmail] = { hash, salt };
    localStorage.setItem(PASSWORDS_STORAGE_KEY, JSON.stringify(hashesMap));
  } catch (e) {
    console.error('Error saving user credential hash', e);
  }

  return newUser;
}

// Authenticate user with Email and Password
export async function loginAdminUser(email: string, password: string): Promise<AdminSession> {
  const cleanEmail = email.toLowerCase().trim();
  const users = getAdminUsers();
  const user = users.find(u => u.email === cleanEmail);

  if (!user) {
    throw new Error('Invalid email or password.');
  }

  const rawHashes = localStorage.getItem(PASSWORDS_STORAGE_KEY);
  if (!rawHashes) {
    throw new Error('Security store unavailable. Please contact the administrator.');
  }

  const hashesMap = JSON.parse(rawHashes);
  const storedCreds = hashesMap[cleanEmail];
  if (!storedCreds) {
    throw new Error('Invalid email or password.');
  }

  // Verify hash with stored salt
  const { hash: computedHash } = await hashPassword(password, storedCreds.salt);
  if (computedHash !== storedCreds.hash) {
    throw new Error('Invalid email or password.');
  }

  // Update last login
  user.lastLogin = new Date().toISOString();
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));

  const session: AdminSession = {
    token: generateToken(),
    user,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };

  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

// Get current active session
export function getCurrentSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session: AdminSession = JSON.parse(raw);
    if (!session || !session.expiresAt || session.expiresAt < Date.now()) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

// Log out user
export function logoutAdminUser(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (e) {
    console.error(e);
  }
}

// Aliases for convenience
export const getStoredSession = getCurrentSession;
export const clearStoredSession = logoutAdminUser;
export const hasAnyAdminUsers = (): boolean => !isFirstTimeSetupRequired();

// Role-Based Access Control checks
export const RBAC = {
  canManageSalon: (role: AdminRole): boolean => role === 'SUPER_ADMIN' || role === 'SALON_ADMIN',
  canManageAppointments: (role: AdminRole): boolean => 
    role === 'SUPER_ADMIN' || role === 'SALON_ADMIN' || role === 'RECEPTIONIST' || role === 'STAFF',
  canCreateAppointment: (role: AdminRole): boolean => 
    role === 'SUPER_ADMIN' || role === 'SALON_ADMIN' || role === 'RECEPTIONIST',
  canManageBilling: (role: AdminRole): boolean => 
    role === 'SUPER_ADMIN' || role === 'SALON_ADMIN' || role === 'RECEPTIONIST',
  canManageCustomers: (role: AdminRole): boolean => 
    role === 'SUPER_ADMIN' || role === 'SALON_ADMIN' || role === 'RECEPTIONIST',
  canManageFeedback: (role: AdminRole): boolean => 
    role === 'SUPER_ADMIN' || role === 'SALON_ADMIN' || role === 'RECEPTIONIST',
  canManageServices: (role: AdminRole): boolean => 
    role === 'SUPER_ADMIN' || role === 'SALON_ADMIN',
  canManageStaff: (role: AdminRole): boolean => 
    role === 'SUPER_ADMIN' || role === 'SALON_ADMIN',
  canManageGallery: (role: AdminRole): boolean => 
    role === 'SUPER_ADMIN' || role === 'SALON_ADMIN' || role === 'STAFF',
  canManageEnquiries: (role: AdminRole): boolean => 
    role === 'SUPER_ADMIN' || role === 'SALON_ADMIN' || role === 'RECEPTIONIST',
  canManageWhatsApp: (role: AdminRole): boolean => 
    role === 'SUPER_ADMIN' || role === 'SALON_ADMIN',
  canManageSettings: (role: AdminRole): boolean => 
    role === 'SUPER_ADMIN' || role === 'SALON_ADMIN',
};
