// Install runtime compatibility before Expo Router loads any application modules.
import "./src/lib/abort-signal-polyfill";
import "expo-router/entry";
