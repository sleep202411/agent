import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { IntegralRecord } from "@/src/types/workspace";

// ─── State ──────────────────────────────────────────────

interface UserState {
  credits: number;
  isCreditsLoading: boolean;
  creditsVersion: number;
  integralRecords: IntegralRecord[];
  isIntegralRecordsLoading: boolean;
}

const initialState: UserState = {
  credits: 0,
  isCreditsLoading: false,
  creditsVersion: 0,
  integralRecords: [],
  isIntegralRecordsLoading: false,
};

// ─── Slice ──────────────────────────────────────────────

export const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    setCredits: (state, action: PayloadAction<number>) => {
      state.credits = action.payload;
      state.isCreditsLoading = false;
    },
    setCreditsLoading: (state, action: PayloadAction<boolean>) => {
      state.isCreditsLoading = action.payload;
    },
    setIntegralRecords: (state, action: PayloadAction<IntegralRecord[]>) => {
      state.integralRecords = action.payload;
      state.isIntegralRecordsLoading = false;
    },
    setIntegralRecordsLoading: (state, action: PayloadAction<boolean>) => {
      state.isIntegralRecordsLoading = action.payload;
    },
    touchCredits: (state) => {
      state.creditsVersion += 1;
    },
  },
});

export const {
  setCredits,
  setCreditsLoading,
  setIntegralRecords,
  setIntegralRecordsLoading,
  touchCredits,
} = userSlice.actions;
