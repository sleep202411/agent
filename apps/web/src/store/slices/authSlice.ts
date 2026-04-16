import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { User } from "@/src/lib/auth";
import { emailLogin as authEmailLogin, getCurrentUser, logout as authLogout } from "@/src/lib/auth";

// ─── State ──────────────────────────────────────────────

interface AuthState {
  user: User | null;
  isLoading: boolean;
}

const initialState: AuthState = {
  user: null,
  isLoading: true,
};

// ─── Thunks ─────────────────────────────────────────────

export const fetchUser = createAsyncThunk("auth/fetchUser", async () => {
  return getCurrentUser();
});

export const login = createAsyncThunk(
  "auth/login",
  async ({ email, pwd }: { email: string; pwd: string }) => {
    return authEmailLogin(email, pwd);
  }
);

export const logout = createAsyncThunk("auth/logout", async () => {
  await authLogout();
});

// ─── Slice ──────────────────────────────────────────────

export const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<User | null>) => {
      state.user = action.payload;
      state.isLoading = false;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchUser.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchUser.fulfilled, (state, action) => {
        state.user = action.payload;
        state.isLoading = false;
      })
      .addCase(fetchUser.rejected, (state) => {
        state.user = null;
        state.isLoading = false;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.user = action.payload;
        state.isLoading = false;
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.isLoading = false;
      });
  },
});

export const { setUser, setLoading } = authSlice.actions;
