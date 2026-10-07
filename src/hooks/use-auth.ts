// Lightweight auth hook using localStorage for guest sessions.
// No Convex dependency — works on any static host (Vercel, Netlify, …).

export interface UserProfile {
  name: string | null;
  email: string | null;
}

const GUEST_USER: UserProfile = {
  name: null,
  email: null,
};

const STORAGE_KEY = "platefix-user-v1";

function getStoredUser(): UserProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { name?: string; email?: string };
    if (parsed && typeof parsed === "object") {
      return { name: parsed.name ?? null, email: parsed.email ?? null };
    }
    return null;
  } catch {
    return null;
  }
}

function setStoredUser(user: UserProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    // localStorage unavailable (private mode, etc.) — guest mode still works
  }
}

function clearStoredUser(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export type AuthState = {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: UserProfile | null;
  signIn: (profile?: Partial<UserProfile>) => void;
  signOut: () => void;
};

export function useAuth(): AuthState {
  // Read once from localStorage; treat as instantly available (guest mode).
  const user = getStoredUser();
  const isAuthenticated = user !== null;

  const signIn = (profile?: Partial<UserProfile>) => {
    const merged: UserProfile = {
      name: profile?.name ?? user?.name ?? null,
      email: profile?.email ?? user?.email ?? null,
    };
    setStoredUser(merged);
  };

  const signOut = () => {
    clearStoredUser();
  };

  return {
    isLoading: false,
    isAuthenticated,
    user: user ?? GUEST_USER,
    signIn,
    signOut,
  };
}
