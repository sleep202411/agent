import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";
import { taskSlice } from "./slices/taskSlice";
import { authSlice } from "./slices/authSlice";
import { projectSlice } from "./slices/projectSlice";
import { userSlice } from "./slices/userSlice";
import { aiModelCacheSlice } from "./slices/aiModelCacheSlice";
import { assistantSlice } from "./slices/assistantSlice";
import { agentSlice } from "./slices/agentSlice";

export const store = configureStore({
  reducer: {
    task: taskSlice.reducer,
    auth: authSlice.reducer,
    project: projectSlice.reducer,
    user: userSlice.reducer,
    aiModelCache: aiModelCacheSlice.reducer,
    assistant: assistantSlice.reducer,
    agent: agentSlice.reducer,
  },
  devTools: process.env.NODE_ENV !== "production",
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore non-serializable File objects in assistant attachments
        ignoredActions: [
          "assistant/pushAttachment",
          "assistant/addAttachments/pending",
          "assistant/addAttachments/fulfilled",
          "assistant/addAttachments/rejected",
        ],
        ignoredPaths: ["assistant.projects"],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
