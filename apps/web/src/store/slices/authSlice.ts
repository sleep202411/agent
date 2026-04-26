import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import { backendApi } from "@/src/lib/api";
import { logout as apiLogout } from "@/src/lib/auth/api";

export interface User {
  id: string;
  email: string;
  nickname: string;
  avatar?: string;
  userLevel?: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
}

const initialState: AuthState = {
  user: null,
  isLoading: true,
};

export const fetchUser = createAsyncThunk("auth/fetchUser", async () => {
  try {
    const info = await backendApi.get<Record<string, unknown> | null>("/user/query/user/info");
    if (!info || typeof info !== "object") return null;
    const id = info.userId ?? info.id;
    if (id === undefined || id === null) return null;
    return {
      id: String(id),
      email: typeof info.email === "string" ? info.email : "",
      nickname:
        (typeof info.nickName === "string" && info.nickName) ||
        (typeof info.userName === "string" && info.userName) ||
        "",
      avatar: typeof info.headImg === "string" ? info.headImg : undefined,
      userLevel: typeof info.userLevel === "string" ? info.userLevel : undefined,
    } satisfies User;
  } catch {
    return null;
  }
});

export const logout = createAsyncThunk("auth/logout", async () => {
  await apiLogout();
});

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
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.isLoading = false;
      });
  },
});

export const { setUser, setLoading } = authSlice.actions;
