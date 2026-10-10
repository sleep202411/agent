import { fetch } from "expo/fetch";
export const streamFetch = (url: string, init: RequestInit) => fetch(url, init);
