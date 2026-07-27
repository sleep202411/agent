import { Redirect } from "expo-router";

/** Register is no longer a separate product surface — Continue covers both. */
export default function RegisterRedirect() {
  return <Redirect href="/login" />;
}
