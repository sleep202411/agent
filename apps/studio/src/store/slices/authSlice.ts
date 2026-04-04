import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { User } from "@/src/lib/auth";
import { logout as authLogout } from "@/src/lib/auth";

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
    builder.addCase(logout.fulfilled, (state) => {
      state.user = null;
      state.isLoading = false;
    });
  },
});

export const { setUser, setLoading } = authSlice.actions;
